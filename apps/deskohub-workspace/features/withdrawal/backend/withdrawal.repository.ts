import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { type ContractWithdrawalRow, contractWithdrawals } from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import type { Money } from "@/shared/money/money";
import type { WithdrawableContractRef } from "../withdrawable-contract";
import type { WithdrawalRefundBasis } from "../withdrawal-assessment";
import type {
  WithdrawableContractKind,
  WithdrawalId,
} from "../withdrawal-identifiers";

/** A recorded withdrawal and how far its settlement got. */
export type ContractWithdrawal = {
  readonly id: WithdrawalId;
  readonly contract: WithdrawableContractRef;
  readonly accountId: CustomerAccountId;
  readonly locale: Locale;
  readonly contractLabel: string;
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
  readonly settlementAttempts: number;
  readonly settlementFailureCode: string | null;
};

/** A settlement step a withdrawal stamps once done. */
export type WithdrawalSettlementStep =
  | "receipt"
  | "operator_notice"
  | "contract_cancellation";

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
>;

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
    EffectDrizzleQueryError
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
  /** Stamps a done step; a lost claim stamps nothing and answers false. */
  readonly markStepDone: (
    claim: SettlementClaim & {
      readonly step: WithdrawalSettlementStep;
      readonly doneAt: Temporal.Instant;
    }
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  /** Marks the withdrawal settled once every step is done, releasing the claim. */
  readonly markSettled: (
    claim: SettlementClaim & { readonly settledAt: Temporal.Instant }
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  /** Records a failed settlement run and when to try again, releasing the claim. */
  readonly recordSettlementFailure: (
    claim: SettlementClaim & {
      readonly failureCode: string;
      readonly nextSettlementAt: Temporal.Instant;
    }
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
            const [inserted] = yield* db
              .insert(contractWithdrawals)
              .values({
                ...toNewRow(withdrawal),
                settlementClaimedAt: withdrawal.submittedAt,
                nextSettlementAt: withdrawal.submittedAt,
              })
              .onConflictDoNothing({
                target: [
                  contractWithdrawals.contractKind,
                  contractWithdrawals.contractId,
                ],
              })
              .returning();
            if (inserted) {
              return {
                withdrawal: toContractWithdrawal(inserted),
                recorded: true,
              };
            }
            const existing = yield* findByContract(withdrawal.contract);
            if (Option.isNone(existing)) {
              return yield* Effect.die(
                new Error(
                  "A conflicting contract withdrawal disappeared before it was read."
                )
              );
            }
            return { withdrawal: existing.value, recorded: false };
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
        markStepDone: Effect.fn("WithdrawalRepository.markStepDone")(
          function* (input) {
            const updated = yield* db
              .update(contractWithdrawals)
              .set({
                [settlementStepColumns[input.step]]: input.doneAt,
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
                settlementFailureCode: null,
                updatedAt: input.settledAt,
              })
              .where(heldClaim(input));
          }
        ),
        recordSettlementFailure: Effect.fn(
          "WithdrawalRepository.recordSettlementFailure"
        )(function* (input) {
          yield* db
            .update(contractWithdrawals)
            .set({
              settlementAttempts: sql`${contractWithdrawals.settlementAttempts} + 1`,
              settlementFailureCode: input.failureCode,
              nextSettlementAt: input.nextSettlementAt,
              settlementClaimedAt: null,
              updatedAt: Temporal.Now.instant(),
            })
            .where(heldClaim(input));
        }),
      } satisfies IWithdrawalRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

const settlementStepColumns = {
  receipt: "receiptSentAt",
  operator_notice: "operatorNotifiedAt",
  contract_cancellation: "contractCancelledAt",
} as const satisfies Record<
  WithdrawalSettlementStep,
  keyof typeof contractWithdrawals.$inferInsert
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
    settlementAttempts: row.settlementAttempts,
    settlementFailureCode: row.settlementFailureCode,
  };
};
