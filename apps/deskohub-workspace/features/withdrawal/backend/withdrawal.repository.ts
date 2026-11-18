import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type ContractWithdrawalRow,
  contractWithdrawals,
  workspaceReservations,
} from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import {
  type ReadLimitExceededError,
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import type { Money } from "@/shared/money/money";
import type { WithdrawableContractRef } from "../withdrawable-contract";
import type { WithdrawalRefundBasis } from "../withdrawal-assessment";
import type {
  WithdrawableContractKind,
  WithdrawalId,
} from "../withdrawal-identifiers";
import type { WithdrawalRecord } from "../withdrawal-read-model";

/** A recorded withdrawal and how far its settlement got. */
export type ContractWithdrawal = {
  readonly id: WithdrawalId;
  readonly contract: WithdrawableContractRef;
  readonly accountId: CustomerAccountId;
  readonly locale: Locale;
  readonly contractLabel: string;
  readonly statementName: string | null;
  readonly submittedAt: Temporal.Instant;
  readonly periodEndsAt: Temporal.Instant;
  readonly paidAmount: Money;
  readonly refundAmount: Money;
  readonly refundBasis: WithdrawalRefundBasis;
  readonly receiptSentAt: Temporal.Instant | null;
  readonly operatorNotifiedAt: Temporal.Instant | null;
  readonly contractCancelledAt: Temporal.Instant | null;
  readonly settledAt: Temporal.Instant | null;
  /** The claim the current settlement run holds, if any. */
  readonly settlementClaimedAt: Temporal.Instant | null;
  /** Each step's own retry state; a step retries independently of the others. */
  readonly stepRetries: Readonly<
    Record<WithdrawalSettlementStep, WithdrawalStepRetry>
  >;
};

/** A settlement step a withdrawal stamps once done. */
export type WithdrawalSettlementStep =
  | "receipt"
  | "operator_notice"
  | "contract_cancellation";

/** The settlement steps in the order a run attempts them. */
export const withdrawalSettlementSteps = [
  "receipt",
  "operator_notice",
  "contract_cancellation",
] as const satisfies readonly WithdrawalSettlementStep[];

/**
 * How a settlement step fared: its failed attempts, the last failure's code
 * until the step succeeds, and when it may run again.
 */
export type WithdrawalStepRetry = {
  readonly attempts: number;
  readonly failureCode: string | null;
  readonly retryAt: Temporal.Instant | null;
};

/** When a withdrawal finished `step`, if it did. */
export const withdrawalStepDoneAt = (
  withdrawal: Pick<
    ContractWithdrawal,
    "receiptSentAt" | "operatorNotifiedAt" | "contractCancelledAt"
  >,
  step: WithdrawalSettlementStep
): Temporal.Instant | null => withdrawal[settlementStepColumns[step].doneAt];

export class WithdrawalContractChangedError extends Data.TaggedError(
  "WithdrawalContractChangedError"
) {}

type NewContractWithdrawal = Pick<
  ContractWithdrawal,
  | "contract"
  | "accountId"
  | "locale"
  | "contractLabel"
  | "submittedAt"
  | "periodEndsAt"
  | "paidAmount"
  | "refundAmount"
  | "refundBasis"
> & { readonly statementName: string };

/** Names the settlement run that holds a withdrawal's claim. */
type SettlementClaim = {
  readonly id: WithdrawalId;
  readonly claimedAt: Temporal.Instant;
};

interface IWithdrawalRepository {
  readonly findByContract: (
    contract: WithdrawableContractRef
  ) => Effect.Effect<
    Option.Option<ContractWithdrawal>,
    EffectDrizzleQueryError
  >;
  /**
   * The account's withdrawals as its data export holds them, oldest first;
   * more than `limit` fails with `ReadLimitExceededError` instead of a
   * truncated list.
   */
  readonly listRecordsForAccount: (input: {
    readonly accountId: CustomerAccountId;
    readonly limit: number;
  }) => Effect.Effect<
    readonly WithdrawalRecord[],
    EffectDrizzleQueryError | ReadLimitExceededError
  >;
  /** Which of the family's contracts have a recorded withdrawal. */
  readonly listWithdrawnContractIds: (input: {
    readonly kind: WithdrawableContractKind;
    readonly contractIds: readonly string[];
  }) => Effect.Effect<ReadonlySet<string>, EffectDrizzleQueryError>;
  /**
   * Records the withdrawal claimed for settlement by the submitting request,
   * or answers the contract's existing withdrawal with `recorded: false`.
   */
  readonly record: (
    withdrawal: NewContractWithdrawal
  ) => Effect.Effect<
    { readonly withdrawal: ContractWithdrawal; readonly recorded: boolean },
    EffectDrizzleQueryError | SqlError.SqlError | WithdrawalContractChangedError
  >;
  /**
   * Claims up to `limit` unsettled withdrawals due for settlement at `now`,
   * taking over claims stamped before `staleClaimBefore`.
   */
  readonly claimDue: (input: {
    readonly now: Temporal.Instant;
    readonly staleClaimBefore: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    readonly ContractWithdrawal[],
    EffectDrizzleQueryError | SqlError.SqlError
  >;
  /**
   * Claims the contract's unsettled withdrawal for a settlement run at
   * `now`, making each waiting step due at once, unless another run holds a
   * claim stamped after `staleClaimBefore`. Answers the withdrawal as it then
   * stands and whether this call claimed it; none when the contract has no
   * withdrawal.
   */
  readonly claimNow: (input: {
    readonly contract: WithdrawableContractRef;
    readonly now: Temporal.Instant;
    readonly staleClaimBefore: Temporal.Instant;
  }) => Effect.Effect<
    Option.Option<{
      readonly withdrawal: ContractWithdrawal;
      readonly claimed: boolean;
    }>,
    EffectDrizzleQueryError
  >;
  /**
   * Stamps a done step and clears its failure; a lost claim stamps nothing
   * and answers false.
   */
  readonly markStepDone: (
    claim: SettlementClaim & {
      readonly step: WithdrawalSettlementStep;
      readonly doneAt: Temporal.Instant;
    }
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  /**
   * Counts a step's failed attempt with its code and when the step may run
   * again; a lost claim records nothing and answers false.
   */
  readonly recordStepFailure: (
    claim: SettlementClaim & {
      readonly step: WithdrawalSettlementStep;
      readonly failureCode: string;
      readonly retryAt: Temporal.Instant;
    }
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  /** Marks the withdrawal settled once every step is done, releasing the claim. */
  readonly markSettled: (
    claim: SettlementClaim & { readonly settledAt: Temporal.Instant }
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  /** Schedules the next settlement run of an unfinished withdrawal, releasing the claim. */
  readonly deferSettlement: (
    claim: SettlementClaim & { readonly nextSettlementAt: Temporal.Instant }
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

export class WithdrawalRepository extends Context.Service<
  WithdrawalRepository,
  IWithdrawalRepository
>()("@deskohub-workspace/withdrawal/WithdrawalRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const findByContract = Effect.fn("WithdrawalRepository.findByContract")(
        function* (contract: WithdrawableContractRef) {
          const [row] = yield* db
            .select()
            .from(contractWithdrawals)
            .where(
              and(
                eq(contractWithdrawals.contractKind, contract.kind),
                eq(contractWithdrawals.contractId, contract.id)
              )
            )
            .limit(1);
          return Option.map(Option.fromNullishOr(row), toContractWithdrawal);
        }
      );

      return {
        findByContract,
        listRecordsForAccount: Effect.fn(
          "WithdrawalRepository.listRecordsForAccount"
        )(function* (input) {
          const rows = yield* db
            .select({
              contractKind: contractWithdrawals.contractKind,
              contractId: contractWithdrawals.contractId,
              contractLabel: contractWithdrawals.contractLabel,
              submittedAt: contractWithdrawals.submittedAt,
              paidAmountValue: contractWithdrawals.paidAmountValue,
              refundAmountValue: contractWithdrawals.refundAmountValue,
              amountExponent: contractWithdrawals.amountExponent,
              currency: contractWithdrawals.currency,
              settledAt: contractWithdrawals.settledAt,
            })
            .from(contractWithdrawals)
            .where(eq(contractWithdrawals.customerAccountId, input.accountId))
            .orderBy(
              asc(contractWithdrawals.submittedAt),
              asc(contractWithdrawals.id)
            )
            .limit(readLimitSentinel(input.limit));
          const within = yield* requireWithinReadLimit(rows, input.limit);
          return within.map(
            (row): WithdrawalRecord => ({
              contractKind: row.contractKind,
              contractId: row.contractId,
              contractLabel: row.contractLabel,
              submittedAt: row.submittedAt,
              paidAmount: {
                value: row.paidAmountValue,
                exponent: row.amountExponent,
                currency: row.currency,
              },
              refundAmount: {
                value: row.refundAmountValue,
                exponent: row.amountExponent,
                currency: row.currency,
              },
              status: row.settledAt ? "completed" : "processing",
            })
          );
        }),
        listWithdrawnContractIds: Effect.fn(
          "WithdrawalRepository.listWithdrawnContractIds"
        )(function* (input) {
          if (input.contractIds.length === 0) return new Set<string>();
          const rows = yield* db
            .select({ contractId: contractWithdrawals.contractId })
            .from(contractWithdrawals)
            .where(
              and(
                eq(contractWithdrawals.contractKind, input.kind),
                inArray(contractWithdrawals.contractId, [...input.contractIds])
              )
            );
          return new Set(rows.map(({ contractId }) => contractId));
        }),
        record: Effect.fn("WithdrawalRepository.record")(
          function* (withdrawal) {
            return yield* transaction(
              Effect.gen(function* () {
                // The operator claim takes the same row lock before reading
                // the ledger. No network work runs while this lock is held.
                const [reservation] = yield* db
                  .select({
                    state: workspaceReservations.reservationState,
                    payment: workspaceReservations.paymentState,
                    author: workspaceReservations.authorAccountId,
                  })
                  .from(workspaceReservations)
                  .where(
                    sql`${workspaceReservations.id} = ${withdrawal.contract.id}`
                  )
                  .for("update");
                const existing = yield* findByContract(withdrawal.contract);
                if (Option.isSome(existing)) {
                  return { withdrawal: existing.value, recorded: false };
                }
                if (
                  reservation?.state !== "confirmed" ||
                  reservation.payment !== "paid" ||
                  reservation.author !== withdrawal.accountId
                ) {
                  return yield* new WithdrawalContractChangedError();
                }
                const [inserted] = yield* db
                  .insert(contractWithdrawals)
                  .values({
                    ...toNewRow(withdrawal),
                    settlementClaimedAt: withdrawal.submittedAt,
                    nextSettlementAt: withdrawal.submittedAt,
                  })
                  .returning();
                if (inserted) {
                  return {
                    withdrawal: toContractWithdrawal(inserted),
                    recorded: true,
                  };
                }
                return yield* Effect.die(
                  new Error(
                    "The locked reservation's withdrawal insert returned no row."
                  )
                );
              })
            );
          },
          (effect, withdrawal) =>
            effect.pipe(
              Effect.annotateLogs({
                contractKind: withdrawal.contract.kind,
                contractId: withdrawal.contract.id,
              })
            )
        ),
        claimDue: Effect.fn("WithdrawalRepository.claimDue")(function* (input) {
          // Lock the batch first and claim exactly those rows, so a
          // re-run subquery never claims more than the limit.
          const claim = transaction(
            Effect.gen(function* () {
              const due = yield* db
                .select({ id: contractWithdrawals.id })
                .from(contractWithdrawals)
                .where(
                  and(
                    isNull(contractWithdrawals.settledAt),
                    lte(contractWithdrawals.nextSettlementAt, input.now),
                    or(
                      isNull(contractWithdrawals.settlementClaimedAt),
                      lte(
                        contractWithdrawals.settlementClaimedAt,
                        input.staleClaimBefore
                      )
                    )
                  )
                )
                .orderBy(asc(contractWithdrawals.nextSettlementAt))
                .limit(input.limit)
                .for("update", { skipLocked: true });
              if (due.length === 0) return [];
              return yield* db
                .update(contractWithdrawals)
                .set({ settlementClaimedAt: input.now, updatedAt: input.now })
                .where(
                  inArray(
                    contractWithdrawals.id,
                    due.map(({ id }) => id)
                  )
                )
                .returning();
            })
          );
          const claimed = yield* claim;
          return claimed.map(toContractWithdrawal);
        }),
        claimNow: Effect.fn("WithdrawalRepository.claimNow")(function* (input) {
          const [claimed] = yield* db
            .update(contractWithdrawals)
            .set({
              settlementClaimedAt: input.now,
              nextSettlementAt: input.now,
              [settlementStepColumns.receipt.retryAt]: null,
              [settlementStepColumns.operator_notice.retryAt]: null,
              [settlementStepColumns.contract_cancellation.retryAt]: null,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(contractWithdrawals.contractKind, input.contract.kind),
                eq(contractWithdrawals.contractId, input.contract.id),
                isNull(contractWithdrawals.settledAt),
                or(
                  isNull(contractWithdrawals.settlementClaimedAt),
                  lte(
                    contractWithdrawals.settlementClaimedAt,
                    input.staleClaimBefore
                  )
                )
              )
            )
            .returning();
          if (claimed) {
            return Option.some({
              withdrawal: toContractWithdrawal(claimed),
              claimed: true,
            });
          }
          const current = yield* findByContract(input.contract);
          return Option.map(current, (withdrawal) => ({
            withdrawal,
            claimed: false,
          }));
        }),
        markStepDone: Effect.fn("WithdrawalRepository.markStepDone")(
          function* (input) {
            const statementName =
              input.step === "receipt"
                ? sql`case when ${contractWithdrawals.operatorNotifiedAt} is null then ${contractWithdrawals.statementName} end`
                : sql`case when ${contractWithdrawals.receiptSentAt} is null then ${contractWithdrawals.statementName} end`;
            const updated = yield* db
              .update(contractWithdrawals)
              .set({
                [settlementStepColumns[input.step].doneAt]: input.doneAt,
                [settlementStepColumns[input.step].failureCode]: null,
                [settlementStepColumns[input.step].retryAt]: null,
                ...(input.step !== "contract_cancellation" && {
                  statementName,
                }),
                updatedAt: input.doneAt,
              })
              .where(heldClaim(input))
              .returning({ id: contractWithdrawals.id });
            return updated.length > 0;
          }
        ),
        markSettled: Effect.fn("WithdrawalRepository.markSettled")(
          function* (input) {
            yield* db
              .update(contractWithdrawals)
              .set({
                settledAt: input.settledAt,
                settlementClaimedAt: null,
                updatedAt: input.settledAt,
              })
              .where(heldClaim(input));
          }
        ),
        recordStepFailure: Effect.fn("WithdrawalRepository.recordStepFailure")(
          function* (input) {
            const columns = settlementStepColumns[input.step];
            const updated = yield* db
              .update(contractWithdrawals)
              .set({
                [columns.attempts]: sql`${contractWithdrawals[columns.attempts]} + 1`,
                [columns.failureCode]: input.failureCode,
                [columns.retryAt]: input.retryAt,
                updatedAt: Temporal.Now.instant(),
              })
              .where(heldClaim(input))
              .returning({ id: contractWithdrawals.id });
            return updated.length > 0;
          }
        ),
        deferSettlement: Effect.fn("WithdrawalRepository.deferSettlement")(
          function* (input) {
            yield* db
              .update(contractWithdrawals)
              .set({
                nextSettlementAt: input.nextSettlementAt,
                settlementClaimedAt: null,
                updatedAt: Temporal.Now.instant(),
              })
              .where(heldClaim(input));
          }
        ),
      } satisfies IWithdrawalRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

const settlementStepColumns = {
  receipt: {
    doneAt: "receiptSentAt",
    attempts: "receiptAttempts",
    failureCode: "receiptFailureCode",
    retryAt: "receiptRetryAt",
  },
  operator_notice: {
    doneAt: "operatorNotifiedAt",
    attempts: "operatorNoticeAttempts",
    failureCode: "operatorNoticeFailureCode",
    retryAt: "operatorNoticeRetryAt",
  },
  contract_cancellation: {
    doneAt: "contractCancelledAt",
    attempts: "cancellationAttempts",
    failureCode: "cancellationFailureCode",
    retryAt: "cancellationRetryAt",
  },
} as const satisfies Record<
  WithdrawalSettlementStep,
  Record<
    "doneAt" | "attempts" | "failureCode" | "retryAt",
    keyof typeof contractWithdrawals.$inferInsert
  >
>;

const heldClaim = (claim: SettlementClaim) =>
  and(
    eq(contractWithdrawals.id, claim.id),
    eq(contractWithdrawals.settlementClaimedAt, claim.claimedAt)
  );

const toNewRow = (withdrawal: NewContractWithdrawal) => ({
  contractKind: withdrawal.contract.kind,
  contractId: withdrawal.contract.id,
  customerAccountId: withdrawal.accountId,
  locale: withdrawal.locale,
  contractLabel: withdrawal.contractLabel,
  statementName: withdrawal.statementName,
  submittedAt: withdrawal.submittedAt,
  periodEndsAt: withdrawal.periodEndsAt,
  paidAmountValue: withdrawal.paidAmount.value,
  refundAmountValue: withdrawal.refundAmount.value,
  amountExponent: withdrawal.paidAmount.exponent,
  currency: withdrawal.paidAmount.currency,
  ...(withdrawal.refundBasis.kind === "partial" && {
    refundUnit: withdrawal.refundBasis.unit,
    refundUnstartedUnits: withdrawal.refundBasis.unstarted,
    refundTotalUnits: withdrawal.refundBasis.total,
  }),
});

/** Reads a stored withdrawal; the table's checks keep its basis whole. */
export const toContractWithdrawal = (
  row: ContractWithdrawalRow
): ContractWithdrawal => {
  const unit = { exponent: row.amountExponent, currency: row.currency };
  return {
    id: row.id,
    contract: { kind: row.contractKind, id: row.contractId },
    accountId: row.customerAccountId,
    locale: row.locale,
    contractLabel: row.contractLabel,
    statementName: row.statementName,
    submittedAt: row.submittedAt,
    periodEndsAt: row.periodEndsAt,
    paidAmount: { value: row.paidAmountValue, ...unit },
    refundAmount: { value: row.refundAmountValue, ...unit },
    refundBasis:
      row.refundUnit &&
      row.refundUnstartedUnits !== null &&
      row.refundTotalUnits !== null
        ? {
            kind: "partial",
            unit: row.refundUnit,
            unstarted: row.refundUnstartedUnits,
            total: row.refundTotalUnits,
          }
        : { kind: "full" },
    receiptSentAt: row.receiptSentAt,
    operatorNotifiedAt: row.operatorNotifiedAt,
    contractCancelledAt: row.contractCancelledAt,
    settledAt: row.settledAt,
    settlementClaimedAt: row.settlementClaimedAt,
    stepRetries: {
      receipt: {
        attempts: row.receiptAttempts,
        failureCode: row.receiptFailureCode,
        retryAt: row.receiptRetryAt,
      },
      operator_notice: {
        attempts: row.operatorNoticeAttempts,
        failureCode: row.operatorNoticeFailureCode,
        retryAt: row.operatorNoticeRetryAt,
      },
      contract_cancellation: {
        attempts: row.cancellationAttempts,
        failureCode: row.cancellationFailureCode,
        retryAt: row.cancellationRetryAt,
      },
    },
  };
};
