import type { NexiCorrelationId } from "@deskohub/nexi";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type PaymentAttemptRow,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  isNexiPaymentAttempt,
  type NexiPaymentAttempt,
  toPaymentAttempt,
} from "./payment-attempt.repository";

/**
 * `recorded` stores a new or larger refund, `unchanged` means the attempt
 * already holds this refund total, and `not_applicable` means the attempt is
 * not a paid Nexi attempt that can carry a refund.
 */
export type PaymentRefundRecordResult =
  | "recorded"
  | "unchanged"
  | "not_applicable";

export interface RefundablePaymentAttempt {
  readonly attempt: NexiPaymentAttempt;
  readonly correlationId: NexiCorrelationId;
}

/** A reservation's payment attempt as its refund facts stand. */
export type ReservationRefundAttempt = Pick<
  PaymentAttemptRow,
  | "amountExponent"
  | "amountValue"
  | "currency"
  | "refundState"
  | "refundedAmountValue"
  | "state"
>;

/** An attempt `claimRefundChecks` stamped, with the stamp it replaced. */
export interface ClaimedRefundCheck extends RefundablePaymentAttempt {
  readonly checkedAt: Temporal.Instant;
  readonly previousCheckedAt: Temporal.Instant | null;
}

export interface IPaymentRefundRepository {
  /**
   * Claims up to `limit` paid Nexi attempts for reservations to check for a
   * refund and stamps them as checked at `checkedAt`. Eligible attempts
   * include outstanding refunds and paid attempts created since
   * `recentPaymentsSince` that Nexi has not fully refunded, because operators
   * can refund in the Nexi back office without cancelling in Workspace and can
   * refund the rest of a partial refund later. An attempt is due once its last
   * check is at or before `lastCheckedBefore`. Due attempts are taken
   * never-checked first, then least recently checked, whatever their group, so
   * every run moves past the attempts it took whatever Nexi reports and no
   * attempt starves the others. Concurrent runs skip each other's claims.
   */
  readonly claimRefundChecks: (input: {
    readonly limit: number;
    readonly checkedAt: Temporal.Instant;
    readonly lastCheckedBefore: Temporal.Instant;
    readonly recentPaymentsSince: Temporal.Instant;
  }) => Effect.Effect<
    readonly ClaimedRefundCheck[],
    EffectDrizzleQueryError | SqlError.SqlError
  >;
  /**
   * Gives back a claim the batch did not check: restores the attempt's
   * previous last-checked time, so the attempt stays due. Only the stamp this
   * claim wrote at `checkedAt` is replaced; a later claim's stamp is kept.
   */
  readonly releaseRefundCheck: (
    claim: Pick<ClaimedRefundCheck, "checkedAt" | "previousCheckedAt"> & {
      readonly id: PaymentAttemptId;
    }
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  /**
   * The reservation's Nexi attempts whose refund is still required, oldest
   * first, each with the reservation's Nexi correlation id. Claims nothing.
   */
  readonly findRequiredRefunds: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    readonly RefundablePaymentAttempt[],
    EffectDrizzleQueryError
  >;
  /** Every payment attempt of the reservation, oldest first. */
  readonly findReservationAttempts: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    readonly ReservationRefundAttempt[],
    EffectDrizzleQueryError
  >;
  /**
   * Records Nexi's successful refund total for a paid Nexi attempt. The total
   * only grows, so a stale or replayed provider read never lowers it.
   */
  readonly recordRefund: (input: {
    readonly id: PaymentAttemptId;
    readonly refundedAmountValue: number;
    readonly refundedAt: Temporal.Instant;
    readonly recordedAt: Temporal.Instant;
  }) => Effect.Effect<PaymentRefundRecordResult, EffectDrizzleQueryError>;
}

export class PaymentRefundRepository extends Context.Service<
  PaymentRefundRepository,
  IPaymentRefundRepository
>()("@deskohub-workspace/checkout/PaymentRefundRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const claimRefundChecks = Effect.fn(
        "PaymentRefundRepository.claimRefundChecks"
      )(function* (input: {
        readonly limit: number;
        readonly checkedAt: Temporal.Instant;
        readonly lastCheckedBefore: Temporal.Instant;
        readonly recentPaymentsSince: Temporal.Instant;
      }) {
        // Lock the batch in its own statement. As an `in (...)` subquery of the
        // update, Postgres may re-run it for every updated row, and each re-run
        // skips the rows already updated, so the claim would exceed `limit`.
        // Every read happens before the commit, so a caller interrupted while
        // claiming either gets the claim back or leaves nothing stamped.
        const { batch, claimed } = yield* transaction(
          Effect.gen(function* () {
            const batch = yield* db
              .select({
                id: paymentAttempts.id,
                previousCheckedAt: paymentAttempts.refundCheckedAt,
                correlationId: workspaceReservations.correlationId,
              })
              .from(paymentAttempts)
              .innerJoin(
                workspaceReservations,
                eq(
                  workspaceReservations.id,
                  paymentAttempts.workspaceReservationId
                )
              )
              .where(
                and(
                  or(
                    eq(paymentAttempts.refundState, "required"),
                    and(
                      eq(paymentAttempts.provider, "nexi"),
                      eq(paymentAttempts.state, "paid"),
                      gte(paymentAttempts.createdAt, input.recentPaymentsSince),
                      or(
                        eq(paymentAttempts.refundState, "not_required"),
                        and(
                          eq(paymentAttempts.refundState, "refunded"),
                          lt(
                            paymentAttempts.refundedAmountValue,
                            paymentAttempts.amountValue
                          )
                        )
                      )
                    )
                  ),
                  or(
                    isNull(paymentAttempts.refundCheckedAt),
                    lte(
                      paymentAttempts.refundCheckedAt,
                      input.lastCheckedBefore
                    )
                  )
                )
              )
              .orderBy(
                sql`${paymentAttempts.refundCheckedAt} asc nulls first`,
                asc(paymentAttempts.updatedAt),
                asc(paymentAttempts.id)
              )
              .limit(input.limit)
              .for("update", { of: paymentAttempts, skipLocked: true });
            if (batch.length === 0) {
              return { batch, claimed: [] };
            }
            const claimed = yield* db
              .update(paymentAttempts)
              .set({ refundCheckedAt: input.checkedAt })
              .where(
                inArray(
                  paymentAttempts.id,
                  batch.map(({ id }) => id)
                )
              )
              .returning();
            return { batch, claimed };
          })
        );
        const checksById = new Map(batch.map((check) => [check.id, check]));

        return claimed.flatMap((row): ClaimedRefundCheck[] => {
          const attempt = toPaymentAttempt(row);
          const check = checksById.get(row.id);
          return check && isNexiPaymentAttempt(attempt)
            ? [
                {
                  attempt,
                  correlationId: check.correlationId,
                  checkedAt: input.checkedAt,
                  previousCheckedAt: check.previousCheckedAt,
                },
              ]
            : [];
        });
      });

      const releaseRefundCheck = Effect.fn(
        "PaymentRefundRepository.releaseRefundCheck"
      )(function* (
        claim: Pick<ClaimedRefundCheck, "checkedAt" | "previousCheckedAt"> & {
          readonly id: PaymentAttemptId;
        }
      ) {
        yield* db
          .update(paymentAttempts)
          .set({ refundCheckedAt: claim.previousCheckedAt })
          .where(
            and(
              eq(paymentAttempts.id, claim.id),
              eq(paymentAttempts.refundCheckedAt, claim.checkedAt)
            )
          );
      });

      const recordRefund = Effect.fn("PaymentRefundRepository.recordRefund")(
        function* (input: {
          readonly id: PaymentAttemptId;
          readonly refundedAmountValue: number;
          readonly refundedAt: Temporal.Instant;
          readonly recordedAt: Temporal.Instant;
        }) {
          const [updated] = yield* db
            .update(paymentAttempts)
            .set({
              refundState: "refunded",
              refundedAmountValue: input.refundedAmountValue,
              refundedAt: input.refundedAt,
              updatedAt: input.recordedAt,
            })
            .where(
              and(
                eq(paymentAttempts.id, input.id),
                eq(paymentAttempts.provider, "nexi"),
                eq(paymentAttempts.state, "paid"),
                or(
                  ne(paymentAttempts.refundState, "refunded"),
                  lt(
                    paymentAttempts.refundedAmountValue,
                    input.refundedAmountValue
                  )
                )
              )
            )
            .returning({ id: paymentAttempts.id });
          if (updated) return "recorded" as const;

          const [existing] = yield* db
            .select({ refundState: paymentAttempts.refundState })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, input.id))
            .limit(1);
          return existing?.refundState === "refunded"
            ? ("unchanged" as const)
            : ("not_applicable" as const);
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      );

      const findRequiredRefunds = Effect.fn(
        "PaymentRefundRepository.findRequiredRefunds"
      )(function* (reservationId: WorkspaceReservationId) {
        const rows = yield* db
          .select({
            attempt: paymentAttempts,
            correlationId: workspaceReservations.correlationId,
          })
          .from(paymentAttempts)
          .innerJoin(
            workspaceReservations,
            eq(workspaceReservations.id, paymentAttempts.workspaceReservationId)
          )
          .where(
            and(
              eq(paymentAttempts.workspaceReservationId, reservationId),
              eq(paymentAttempts.provider, "nexi"),
              eq(paymentAttempts.refundState, "required")
            )
          )
          .orderBy(asc(paymentAttempts.createdAt), asc(paymentAttempts.id));
        return rows.flatMap(({ attempt: row, correlationId }) => {
          const attempt = toPaymentAttempt(row);
          return isNexiPaymentAttempt(attempt)
            ? [{ attempt, correlationId }]
            : [];
        });
      });

      const findReservationAttempts = Effect.fn(
        "PaymentRefundRepository.findReservationAttempts"
      )(function* (reservationId: WorkspaceReservationId) {
        return yield* db
          .select({
            amountExponent: paymentAttempts.amountExponent,
            amountValue: paymentAttempts.amountValue,
            currency: paymentAttempts.currency,
            refundState: paymentAttempts.refundState,
            refundedAmountValue: paymentAttempts.refundedAmountValue,
            state: paymentAttempts.state,
          })
          .from(paymentAttempts)
          .where(eq(paymentAttempts.workspaceReservationId, reservationId))
          .orderBy(asc(paymentAttempts.createdAt), asc(paymentAttempts.id));
      });

      return {
        claimRefundChecks,
        findRequiredRefunds,
        findReservationAttempts,
        recordRefund,
        releaseRefundCheck,
      };
    })
  );
}
