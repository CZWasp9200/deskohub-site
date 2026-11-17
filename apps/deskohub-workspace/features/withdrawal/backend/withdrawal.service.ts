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
import type {
  ContractCancellationError,
  WithdrawableContractFamily,
  WithdrawableContractRef,
} from "../withdrawable-contract";
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
} from "./withdrawal.repository";
import { WithdrawalEmails } from "./withdrawal-emails.service";

export class WithdrawalRefusedError extends Data.TaggedError(
  "WithdrawalRefusedError"
)<{
  readonly reason: WithdrawalRefusal;
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

type WithdrawalFailure =
  | WithdrawalRefusedError
  | WithdrawalUnavailableError
  | CustomerAccountAccessError;

/** What one settlement pass did. */
export type WithdrawalSettlementSummary = {
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
   * Records the signed-in author's withdrawal, then sends the receipt, the
   * operator notice and ends the contract. Only recording can fail the
   * customer: a later step that fails is retried by `settleDue`. Submitting
   * again answers the recorded withdrawal's receipt.
   */
  readonly withdraw: (
    input: WithdrawalInput
  ) => Effect.Effect<WithdrawalReceipt, WithdrawalFailure>;
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
       * Runs the withdrawal's unfinished steps under the claim it holds, in
       * order: receipt, operator notice, cancellation. A step that fails ends
       * the run and schedules the next one; the claim's loss ends it quietly.
       */
      const settle = Effect.fnUntraced(function* (
        withdrawal: ContractWithdrawal,
        known?: {
          readonly receiptEmail: string;
          readonly customerName: string | null;
        }
      ) {
        const claimedAt = withdrawal.settlementClaimedAt;
        if (!claimedAt) return "skipped" as const;
        const claim = { id: withdrawal.id, claimedAt };
        const family = families.get(withdrawal.contract.kind);

        const runStep = <E extends { readonly _tag: string }>(
          step: WithdrawalSettlementStep,
          work: Effect.Effect<void, E>,
          isTransient: (error: E) => boolean,
          failureCode: (error: E) => string
        ) =>
          work.pipe(
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
            Effect.flatMap((held) =>
              held ? Effect.void : Effect.fail(new SettlementClaimLostError())
            )
          );

        // Each step runs even when an earlier one failed, so a failing email
        // never holds up the cancellation; the run then fails with the first
        // step's failure and every unfinished step is retried.
        const settlement = Effect.gen(function* () {
          const failures: SettlementStepError[] = [];
          const attempt = <E extends { readonly _tag: string }>(
            step: WithdrawalSettlementStep,
            work: Effect.Effect<void, E>,
            isTransient: (error: E) => boolean,
            failureCode: (error: E) => string
          ) =>
            runStep(step, work, isTransient, failureCode).pipe(
              Effect.catchTag("SettlementStepError", (failure) =>
                Effect.sync(() => {
                  failures.push(failure);
                })
              )
            );
          const needsEmail =
            !withdrawal.receiptSentAt || !withdrawal.operatorNotifiedAt;
          const receiptEmail = needsEmail
            ? (known?.receiptEmail ??
              (yield* accountEmail(withdrawal.accountId).pipe(
                Effect.catch((cause) =>
                  Effect.sync(() => {
                    failures.push(
                      new SettlementStepError({
                        step: "receipt",
                        code: "receipt_address_unavailable",
                        causeTag: cause._tag,
                        cause,
                      })
                    );
                    return undefined;
                  })
                )
              )))
            : undefined;
          if (!withdrawal.receiptSentAt && receiptEmail) {
            yield* attempt(
              "receipt",
              emails.sendReceipt({
                withdrawal,
                receiptEmail,
                customerName: known?.customerName ?? null,
              }),
              () => true,
              () => "receipt_send_failed"
            );
          }
          if (!withdrawal.operatorNotifiedAt && receiptEmail) {
            yield* attempt(
              "operator_notice",
              emails.sendOperatorNotice({
                withdrawal,
                customerEmail: receiptEmail,
              }),
              () => true,
              () => "operator_notice_failed"
            );
          }
          if (!withdrawal.contractCancelledAt) {
            yield* attempt(
              "contract_cancellation",
              family.cancel({
                contractId: withdrawal.contract.id,
                refundAmount: withdrawal.refundAmount,
                refundBasis: withdrawal.refundBasis,
              }),
              (error: ContractCancellationError) => error.transient,
              (error: ContractCancellationError) => error.code
            );
          }
          const [firstFailure] = failures;
          if (firstFailure) return yield* firstFailure;
          yield* repository.markSettled({
            ...claim,
            settledAt: Temporal.Now.instant(),
          });
          return "settled" as const;
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
              const failureCode =
                error._tag === "SettlementStepError"
                  ? error.code
                  : "settlement_record_failed";
              // Only fixed codes: a provider failure may carry the address.
              yield* Effect.logWarning("Withdrawal settlement failed").pipe(
                Effect.annotateLogs({
                  failureCode,
                  failureTag: failureTagOf(error),
                  settlementAttempts: withdrawal.settlementAttempts + 1,
                })
              );
              yield* repository
                .recordSettlementFailure({
                  ...claim,
                  failureCode,
                  nextSettlementAt: Temporal.Now.instant().add({
                    milliseconds: Duration.toMillis(
                      settlementRetryDelay(withdrawal.settlementAttempts)
                    ),
                  }),
                })
                .pipe(
                  Effect.catch((recordError) =>
                    Effect.logError(
                      "Withdrawal settlement failure could not be recorded"
                    ).pipe(
                      Effect.annotateLogs({
                        failureCode,
                        failureTag: failureTagOf(recordError),
                      })
                    )
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
                return {
                  contractId: contract.ref.id,
                  contractLabel: contract.label,
                  customerName,
                  receiptEmail: held.email,
                  paidAmount: contract.paidAmount,
                  refundAmount: assessment.refundAmount,
                  refundBasis: assessment.refundBasis,
                  periodEndsAt: assessment.periodEndsAt,
                } satisfies WithdrawalQuote;
              })
            );
          },
          (effect, input) => effect.pipe(annotateWithdrawalInput(input))
        ),
        withdraw: Effect.fn("WithdrawalService.withdraw")(
          function* (input) {
            const family = families.get(input.contract.kind);
            const customerName = yield* currentCustomerName;
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
                  const { contract, assessment } = assessed;
                  const result = yield* repository
                    .record({
                      contract: contract.ref,
                      accountId: input.accountId,
                      locale: input.locale,
                      contractLabel: contract.label,
                      submittedAt,
                      periodEndsAt: assessment.periodEndsAt,
                      paidAmount: contract.paidAmount,
                      refundAmount: assessment.refundAmount,
                      refundBasis: assessment.refundBasis,
                    })
                    .pipe(Effect.mapError(ledgerUnavailable));
                  return { ...result, receiptEmail: held.email };
                })
              );
            if (recorded) {
              yield* Effect.logInfo("Withdrawal recorded");
              yield* settle(withdrawal, { receiptEmail, customerName });
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

/** The tag of a failure, or of the failure a settlement step wraps. */
const failureTagOf = (
  error: SettlementStepError | { readonly _tag: string }
) => (error instanceof SettlementStepError ? error.causeTag : error._tag);

/** How long a settlement run owns its claim before another may take over. */
const settlementClaimLifetime = Duration.minutes(10);

/**
 * The wait before the next settlement run after `attempts` failed runs:
 * five minutes, doubling up to six hours, so a lasting failure keeps being
 * retried while administrators see it waiting.
 */
export const settlementRetryDelay = (attempts: number) =>
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
