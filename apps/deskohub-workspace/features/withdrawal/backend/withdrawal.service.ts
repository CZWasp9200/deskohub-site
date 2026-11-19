import { createHash } from "node:crypto";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CustomerAccountAccessError,
  CustomerAccountContactService,
  CustomerAccountSections,
  HeldCustomerAccount,
} from "@/features/account";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { ReservationWithdrawals } from "@/features/reservation/backend/reservation-withdrawals";
import type { Money } from "@/shared/money/money";
import type {
  ContractCancellationError,
  WithdrawableContract,
  WithdrawableContractFamily,
  WithdrawableContractRef,
} from "../withdrawable-contract";
import type { WithdrawalAssessment } from "../withdrawal-assessment";
import type {
  WithdrawalQuote,
  WithdrawalReceipt,
  WithdrawalRefusal,
} from "../withdrawal-read-model";
import { WithdrawableContractFamilies } from "./withdrawable-contract-families";
import {
  type ContractWithdrawal,
  WithdrawalRepository,
  type WithdrawalSettlementStep,
  withdrawalSettlementSteps,
  withdrawalStepDoneAt,
} from "./withdrawal.repository";
import { WithdrawalEmails } from "./withdrawal-emails.service";

export class WithdrawalRefusedError extends Data.TaggedError(
  "WithdrawalRefusedError"
)<{
  readonly reason: WithdrawalRefusal;
}> {}

/**
 * The statement has no name to carry: the profile has none and the customer
 * didn't type one.
 */
export class WithdrawalNameRequiredError extends Data.TaggedError(
  "WithdrawalNameRequiredError"
) {}

export class WithdrawalRefundChangedError extends Data.TaggedError(
  "WithdrawalRefundChangedError"
)<{
  readonly quote: WithdrawalQuote;
}> {}

/** The withdrawal ledger or the contract's family couldn't be read. */
export class WithdrawalUnavailableError extends Data.TaggedError(
  "WithdrawalUnavailableError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type WithdrawalInput = {
  readonly accountId: CustomerAccountId;
  readonly contract: WithdrawableContractRef;
  readonly locale: Locale;
};

/**
 * A withdrawal statement. `customerName` is the name the customer typed for
 * it, used only when the profile has none.
 */
type WithdrawalSubmission = WithdrawalInput & {
  readonly customerName?: string;
  readonly refundTermsKey?: string;
};

function makeWithdrawalQuote(
  contract: WithdrawableContract,
  assessment: Extract<WithdrawalAssessment, { withdrawable: true }>,
  customerName: string | null,
  receiptEmail: string
): WithdrawalQuote {
  const { refundAmount, refundBasis, periodEndsAt } = assessment;
  const moneyTerms = ({ value, currency, exponent }: Money) => [
    value,
    currency,
    exponent,
  ];
  const basisTerms =
    refundBasis.kind === "full"
      ? ["full"]
      : ["partial", refundBasis.unit, refundBasis.unstarted, refundBasis.total];
  const refundTermsKey = createHash("sha256")
    .update(
      JSON.stringify([
        contract.ref.kind,
        contract.ref.id,
        moneyTerms(contract.paidAmount),
        moneyTerms(refundAmount),
        basisTerms,
      ])
    )
    .digest("hex");
  return {
    contractId: contract.ref.id,
    contractLabel: contract.label,
    customerName,
    receiptEmail,
    paidAmount: contract.paidAmount,
    refundAmount,
    refundBasis,
    refundTermsKey,
    periodEndsAt,
  };
}

type WithdrawalFailure =
  | WithdrawalRefusedError
  | WithdrawalUnavailableError
  | CustomerAccountAccessError;

/**
 * What a manual settlement did. `in_progress` means the attempt couldn't
 * acquire or keep the claim. The competing run may have ended by the time
 * this attempt reads the withdrawal again.
 */
type WithdrawalSettleNowOutcome =
  | "settled"
  | "failed"
  | "already_settled"
  | "in_progress";

/** What one settlement pass did. */
type WithdrawalSettlementSummary = {
  readonly claimed: number;
  readonly settled: number;
  readonly failed: number;
};

interface IWithdrawalService {
  /** The signed-in author's withdrawal quote for a contract they may withdraw from now. */
  readonly quote: (
    input: WithdrawalInput
  ) => Effect.Effect<WithdrawalQuote, WithdrawalFailure>;
  /**
   * Records the signed-in author's withdrawal if the refund terms match the
   * confirmed quote, then sends the receipt, the operator notice and ends the
   * contract. A later step that fails is retried by `settleDue`. Submitting
   * again answers the recorded withdrawal's receipt. The statement carries
   * the profile name, else the trimmed typed one; with neither, a new
   * withdrawal fails with `WithdrawalNameRequiredError`.
   */
  readonly withdraw: (
    input: WithdrawalSubmission
  ) => Effect.Effect<
    WithdrawalReceipt,
    | WithdrawalFailure
    | WithdrawalNameRequiredError
    | WithdrawalRefundChangedError
  >;
  /**
   * Settles the contract's withdrawal now, as `settleDue` would with every
   * waiting step due, for an administrator who fixed a failure's cause.
   * Answers none when the contract has no withdrawal.
   */
  readonly settleNow: (contract: WithdrawableContractRef) => Effect.Effect<
    Option.Option<{
      readonly outcome: WithdrawalSettleNowOutcome;
      readonly withdrawal: ContractWithdrawal;
    }>,
    WithdrawalUnavailableError
  >;
  /** Retries the unfinished steps of up to `limit` due withdrawals. */
  readonly settleDue: (input: {
    readonly limit: number;
  }) => Effect.Effect<WithdrawalSettlementSummary, WithdrawalUnavailableError>;
}

/** Customers' withdrawals from contracts of every family. */
export class WithdrawalService extends Context.Service<
  WithdrawalService,
  IWithdrawalService
>()("@deskohub-workspace/withdrawal/WithdrawalService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const repository = yield* WithdrawalRepository;
      const emails = yield* WithdrawalEmails;
      const families = yield* WithdrawableContractFamilies;
      const sections = yield* CustomerAccountSections;
      const contacts = yield* CustomerAccountContactService;

      const ledgerUnavailable = (cause: unknown) =>
        new WithdrawalUnavailableError({
          message: "The withdrawal ledger could not be read or written.",
          cause,
        });

      /** The customer's profile name, when one can be read; never fails. */
      const currentCustomerName = contacts.current.pipe(
        Effect.map((contact) => contact?.name ?? null),
        Effect.orElseSucceed(() => null)
      );

      /** Reads the contract and its standing under the account's hold. */
      const assessHeld = Effect.fnUntraced(function* (
        family: WithdrawableContractFamily,
        input: WithdrawalInput,
        now: Temporal.Instant
      ) {
        const existing = yield* repository
          .findByContract(input.contract)
          .pipe(Effect.mapError(ledgerUnavailable));
        if (Option.isSome(existing)) {
          return yield* new WithdrawalRefusedError({
            reason:
              existing.value.accountId === input.accountId
                ? "already_withdrawn"
                : "not_found",
          });
        }
        const contract = yield* family
          .find({
            contractId: input.contract.id,
            accountId: input.accountId,
            locale: input.locale,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WithdrawalUnavailableError({
                  message: "The contract could not be read.",
                  cause,
                })
            )
          );
        if (Option.isNone(contract)) {
          return yield* new WithdrawalRefusedError({ reason: "not_found" });
        }
        const assessment = contract.value.assess(now);
        if (!assessment.withdrawable) {
          return yield* new WithdrawalRefusedError({
            reason: assessment.reason,
          });
        }
        return { contract: contract.value, assessment };
      });

      /** The account's login email, read under a hold without a session. */
      const accountEmail = (accountId: CustomerAccountId) =>
        sections.withActiveAccount(
          accountId,
          Effect.gen(function* () {
            return (yield* HeldCustomerAccount).email;
          }),
          { recheck: "active" }
        );

      /**
       * Runs the withdrawal's unfinished steps that are due, under the claim
       * it holds, in order: receipt, operator notice, cancellation. Each step
       * retries on its own schedule, so a failing email never holds the
       * cancellation back. The run settles the withdrawal once every step is
       * done, else schedules the next run for the earliest step retry; the
       * claim's loss ends it quietly.
       */
      const settle = Effect.fnUntraced(function* (
        withdrawal: ContractWithdrawal,
        receiptEmail?: string
      ) {
        const claimedAt = withdrawal.settlementClaimedAt;
        if (!claimedAt) return "skipped" as const;
        const claim = { id: withdrawal.id, claimedAt };
        const family = families.get(withdrawal.contract.kind);
        const startedAt = Temporal.Now.instant();
        const done = new Set(
          withdrawalSettlementSteps.filter((step) =>
            withdrawalStepDoneAt(withdrawal, step)
          )
        );
        const retriesScheduled = new Map<
          WithdrawalSettlementStep,
          Temporal.Instant
        >();
        const isDue = (step: WithdrawalSettlementStep) => {
          if (done.has(step)) return false;
          const { retryAt } = withdrawal.stepRetries[step];
          return !retryAt || Temporal.Instant.compare(retryAt, startedAt) <= 0;
        };
        const keepClaim = (held: boolean) =>
          held ? Effect.void : Effect.fail(new SettlementClaimLostError());

        const recordFailure = Effect.fnUntraced(function* (
          failure: SettlementStepError
        ) {
          const { attempts } = withdrawal.stepRetries[failure.step];
          const retryAt = Temporal.Now.instant().add({
            milliseconds: Duration.toMillis(settlementRetryDelay(attempts)),
          });
          // Only fixed codes: a provider failure may carry the address.
          yield* Effect.logWarning("Withdrawal settlement step failed").pipe(
            Effect.annotateLogs({
              step: failure.step,
              failureCode: failure.code,
              failureTag: failure.causeTag,
              stepAttempts: attempts + 1,
            })
          );
          retriesScheduled.set(failure.step, retryAt);
          yield* keepClaim(
            yield* repository.recordStepFailure({
              ...claim,
              step: failure.step,
              failureCode: failure.code,
              retryAt,
            })
          );
        });

        const runStep = <E extends { readonly _tag: string }>(
          step: WithdrawalSettlementStep,
          work: Effect.Effect<void, E>,
          isTransient: (error: E) => boolean,
          failureCode: (error: E) => string
        ) =>
          isDue(step)
            ? work.pipe(
                Effect.retry({
                  schedule: Schedule.exponential("250 millis"),
                  times: 2,
                  while: isTransient,
                }),
                Effect.mapError(
                  (cause) =>
                    new SettlementStepError({
                      step,
                      code: failureCode(cause),
                      causeTag: cause._tag,
                      cause,
                    })
                ),
                Effect.andThen(
                  repository.markStepDone({
                    ...claim,
                    step,
                    doneAt: Temporal.Now.instant(),
                  })
                ),
                Effect.flatMap(keepClaim),
                Effect.andThen(
                  Effect.sync(() => {
                    done.add(step);
                  })
                ),
                Effect.catchTag("SettlementStepError", recordFailure)
              )
            : Effect.void;

        /**
         * The address the due emails go to; an unreadable one fails each due
         * email step, and the cancellation still runs.
         */
        const readCustomerEmail = (
          dueEmailSteps: readonly WithdrawalSettlementStep[]
        ) => {
          if (dueEmailSteps.length === 0) {
            return Effect.succeed(Option.none<string>());
          }
          if (receiptEmail) return Effect.succeed(Option.some(receiptEmail));
          return accountEmail(withdrawal.accountId).pipe(
            Effect.map(Option.some),
            Effect.catch((cause) =>
              Effect.as(
                Effect.forEach(dueEmailSteps, (step) =>
                  recordFailure(
                    new SettlementStepError({
                      step,
                      code: "customer_address_unavailable",
                      causeTag: cause._tag,
                      cause,
                    })
                  )
                ),
                Option.none<string>()
              )
            )
          );
        };

        const settlement = Effect.gen(function* () {
          const dueEmailSteps = (
            ["receipt", "operator_notice"] as const
          ).filter(isDue);
          const customerEmail = yield* readCustomerEmail(dueEmailSteps);
          if (Option.isSome(customerEmail)) {
            // The receipt goes first: the law asks for it without delay.
            yield* runStep(
              "receipt",
              emails.sendReceipt({
                withdrawal,
                receiptEmail: customerEmail.value,
              }),
              () => true,
              () => "receipt_send_failed"
            );
            yield* runStep(
              "operator_notice",
              emails.sendOperatorNotice({
                withdrawal,
                customerEmail: customerEmail.value,
              }),
              () => true,
              () => "operator_notice_failed"
            );
          }
          yield* runStep(
            "contract_cancellation",
            family.cancel({
              contractId: withdrawal.contract.id,
              refundAmount: withdrawal.refundAmount,
              refundBasis: withdrawal.refundBasis,
            }),
            (error: ContractCancellationError) => error.transient,
            (error: ContractCancellationError) => error.code
          );
          const unfinished = withdrawalSettlementSteps.filter(
            (step) => !done.has(step)
          );
          if (unfinished.length === 0) {
            yield* repository.markSettled({
              ...claim,
              settledAt: Temporal.Now.instant(),
            });
            return "settled" as const;
          }
          yield* repository.deferSettlement({
            ...claim,
            nextSettlementAt: unfinished
              .map(
                (step) =>
                  retriesScheduled.get(step) ??
                  withdrawal.stepRetries[step].retryAt ??
                  startedAt
              )
              .reduce((earliest, retryAt) =>
                Temporal.Instant.compare(retryAt, earliest) < 0
                  ? retryAt
                  : earliest
              ),
          });
          return retriesScheduled.size > 0
            ? ("failed" as const)
            : ("deferred" as const);
        });

        return yield* settlement.pipe(
          Effect.catchTag("SettlementClaimLostError", () =>
            Effect.as(
              Effect.logInfo(
                "Withdrawal settlement stopped: another run took the claim"
              ),
              "skipped" as const
            )
          ),
          Effect.catch(
            Effect.fn(function* (error) {
              // The ledger itself failed; try again after the first delay.
              yield* Effect.logError(
                "Withdrawal settlement could not record its progress"
              ).pipe(Effect.annotateLogs({ failureTag: error._tag }));
              yield* repository
                .deferSettlement({
                  ...claim,
                  nextSettlementAt: Temporal.Now.instant().add({
                    milliseconds: Duration.toMillis(settlementRetryDelay(0)),
                  }),
                })
                .pipe(
                  Effect.catch((deferError) =>
                    Effect.logError(
                      "Withdrawal settlement could not schedule its next run"
                    ).pipe(Effect.annotateLogs({ failureTag: deferError._tag }))
                  )
                );
              return "failed" as const;
            })
          ),
          Effect.annotateLogs({
            withdrawalId: withdrawal.id,
            contractKind: withdrawal.contract.kind,
            contractId: withdrawal.contract.id,
          })
        );
      });

      return {
        quote: Effect.fn("WithdrawalService.quote")(
          function* (input) {
            const family = families.get(input.contract.kind);
            const customerName = yield* currentCustomerName;
            return yield* sections.withActiveAccount(
              input.accountId,
              Effect.gen(function* () {
                const held = yield* HeldCustomerAccount;
                const { contract, assessment } = yield* assessHeld(
                  family,
                  input,
                  Temporal.Now.instant()
                );
                return makeWithdrawalQuote(
                  contract,
                  assessment,
                  customerName,
                  held.email
                );
              })
            );
          },
          (effect, input) => effect.pipe(annotateWithdrawalInput(input))
        ),
        withdraw: Effect.fn("WithdrawalService.withdraw")(
          function* (input) {
            const family = families.get(input.contract.kind);
            const profileName = yield* currentCustomerName;
            const customerName =
              profileName ?? (input.customerName?.trim() || null);
            const { withdrawal, recorded, receiptEmail } =
              yield* sections.withActiveAccount(
                input.accountId,
                Effect.gen(function* () {
                  const held = yield* HeldCustomerAccount;
                  const submittedAt = Temporal.Now.instant();
                  const assessed = yield* assessHeld(
                    family,
                    input,
                    submittedAt
                  ).pipe(
                    Effect.catchIf(
                      (error) =>
                        error._tag === "WithdrawalRefusedError" &&
                        error.reason === "already_withdrawn",
                      () => Effect.succeed(undefined)
                    )
                  );
                  if (!assessed) {
                    const existing = yield* repository
                      .findByContract(input.contract)
                      .pipe(
                        Effect.mapError(ledgerUnavailable),
                        Effect.flatMap(
                          Option.match({
                            onNone: () =>
                              Effect.fail(
                                new WithdrawalRefusedError({
                                  reason: "not_found",
                                })
                              ),
                            onSome: Effect.succeed,
                          })
                        )
                      );
                    return {
                      withdrawal: existing,
                      recorded: false,
                      receiptEmail: held.email,
                    };
                  }
                  if (input.refundTermsKey === undefined) {
                    return yield* new WithdrawalRefusedError({
                      reason: "not_withdrawable",
                    });
                  }
                  const { contract, assessment } = assessed;
                  const quote = makeWithdrawalQuote(
                    contract,
                    assessment,
                    profileName,
                    held.email
                  );
                  if (input.refundTermsKey !== quote.refundTermsKey) {
                    return yield* new WithdrawalRefundChangedError({ quote });
                  }
                  if (customerName === null) {
                    return yield* new WithdrawalNameRequiredError();
                  }
                  const result = yield* repository
                    .record({
                      contract: contract.ref,
                      accountId: input.accountId,
                      locale: input.locale,
                      contractLabel: contract.label,
                      statementName: customerName,
                      submittedAt,
                      periodEndsAt: assessment.periodEndsAt,
                      paidAmount: contract.paidAmount,
                      refundAmount: assessment.refundAmount,
                      refundBasis: assessment.refundBasis,
                    })
                    .pipe(
                      Effect.mapError((error) =>
                        error._tag === "WithdrawalContractChangedError"
                          ? new WithdrawalRefusedError({
                              reason: "not_withdrawable",
                            })
                          : ledgerUnavailable(error)
                      )
                    );
                  return { ...result, receiptEmail: held.email };
                })
              );
            if (recorded) {
              yield* Effect.logInfo("Withdrawal recorded");
              yield* settle(withdrawal, receiptEmail);
            }
            return {
              withdrawalId: withdrawal.id,
              submittedAt: withdrawal.submittedAt,
              refundAmount: withdrawal.refundAmount,
              receiptEmail,
            } satisfies WithdrawalReceipt;
          },
          (effect, input) => effect.pipe(annotateWithdrawalInput(input))
        ),
        settleNow: Effect.fn("WithdrawalService.settleNow")(
          function* (contract) {
            const now = Temporal.Now.instant();
            const found = yield* repository
              .claimNow({
                contract,
                now,
                staleClaimBefore: now.subtract({
                  milliseconds: Duration.toMillis(settlementClaimLifetime),
                }),
              })
              .pipe(Effect.mapError(ledgerUnavailable));
            if (Option.isNone(found)) return Option.none();
            const { withdrawal, claimed } = found.value;
            const unclaimedOutcome = withdrawal.settledAt
              ? "already_settled"
              : "skipped";
            const outcome = claimed
              ? yield* settle(withdrawal)
              : unclaimedOutcome;
            const current = yield* repository
              .findByContract(contract)
              .pipe(Effect.mapError(ledgerUnavailable));
            const manualOutcome = {
              already_settled: "already_settled",
              settled: "settled",
              failed: "failed",
              // Waiting steps are due under the manual claim.
              deferred: "failed",
              skipped: "in_progress",
            } as const;
            return Option.map(current, (latest) => ({
              outcome: manualOutcome[outcome],
              withdrawal: latest,
            }));
          },
          (effect, contract) =>
            effect.pipe(
              Effect.annotateLogs({
                contractKind: contract.kind,
                contractId: contract.id,
              })
            )
        ),
        settleDue: Effect.fn("WithdrawalService.settleDue")(function* (input) {
          const now = Temporal.Now.instant();
          const claimed = yield* repository
            .claimDue({
              now,
              staleClaimBefore: now.subtract({
                milliseconds: Duration.toMillis(settlementClaimLifetime),
              }),
              limit: input.limit,
            })
            .pipe(Effect.mapError(ledgerUnavailable));
          const outcomes = yield* Effect.forEach(claimed, (withdrawal) =>
            settle(withdrawal)
          );
          return {
            claimed: claimed.length,
            settled: outcomes.filter((outcome) => outcome === "settled").length,
            failed: outcomes.filter((outcome) => outcome === "failed").length,
          };
        }),
      } satisfies IWithdrawalService;
    })
  );

  /** The service over the authentication the channel provides. */
  static ForProvidedAuthentication = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WithdrawalRepository.Default,
        WithdrawalEmails.Live,
        WithdrawableContractFamilies.Default.pipe(
          Layer.provide(ReservationWithdrawals.Live)
        ),
        CustomerAccountSections.ForProvidedAuthentication,
        CustomerAccountContactService.ForProvidedAuthentication
      )
    ),
    Layer.provide(WorkspaceDatabase.Default)
  );

  /** The service reading the browser session. */
  static Live = this.ForProvidedAuthentication.pipe(
    Layer.provide(CustomerAuthentication.Default)
  );
}

/** A settlement step failed after its immediate retries. */
class SettlementStepError extends Data.TaggedError("SettlementStepError")<{
  readonly step: WithdrawalSettlementStep;
  readonly code: string;
  /** The wrapped failure's tag, the only part of it logs carry. */
  readonly causeTag: string;
  readonly cause: unknown;
}> {}

/** Another settlement run took over this withdrawal's claim. */
class SettlementClaimLostError extends Data.TaggedError(
  "SettlementClaimLostError"
) {}

/** How long a settlement run owns its claim before another may take over. */
const settlementClaimLifetime = Duration.minutes(10);

/**
 * The wait before a settlement step's next attempt after `attempts` failed
 * ones: five minutes, doubling up to six hours, so a lasting failure keeps
 * being retried while administrators see it waiting.
 */
const settlementRetryDelay = (attempts: number) =>
  Duration.min(
    Duration.minutes(5 * 2 ** Math.min(attempts, 10)),
    Duration.hours(6)
  );

const annotateWithdrawalInput =
  (input: WithdrawalInput) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.annotateLogs({
        contractKind: input.contract.kind,
        contractId: input.contract.id,
      })
    );
