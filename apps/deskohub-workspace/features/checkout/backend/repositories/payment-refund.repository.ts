import type { NexiCorrelationId } from "@deskohub/nexi";
import { and, asc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { paymentAttempts, workspaceReservations } from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
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

export interface IPaymentRefundRepository {
  /**
   * Claims up to `limit` paid Nexi attempts to check for a refund and stamps
   * them as checked at `checkedAt`. Attempts whose refund is still outstanding
   * come first. The rest of the batch takes paid attempts created since
   * `recentPaymentsSince` that nobody marked for refund, because operators can
   * refund in the Nexi back office without cancelling in Workspace. Within each
   * group, never-checked attempts come first, then the least recently checked,
   * so every run moves past the attempts it took whatever Nexi reports and no
   * attempt starves the others. Concurrent runs skip each other's claims.
   */
  readonly claimRefundChecks: (input: {
    readonly limit: number;
    readonly checkedAt: Temporal.Instant;
    readonly recentPaymentsSince: Temporal.Instant;
  }) => Effect.Effect<
    readonly RefundablePaymentAttempt[],
    EffectDrizzleQueryError | SqlError.SqlError
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
      const { db } = yield* WorkspaceDatabase;

      const claimRefundChecks = Effect.fn(
        "PaymentRefundRepository.claimRefundChecks"
      )(function* (input: {
        readonly limit: number;
        readonly checkedAt: Temporal.Instant;
        readonly recentPaymentsSince: Temporal.Instant;
      }) {
        // Lock the batch in its own statement. As an `in (...)` subquery of the
        // update, Postgres may re-run it for every updated row, and each re-run
        // skips the rows already updated, so the claim would exceed `limit`.
        const claimed = yield* db.transaction(
          Effect.fn(function* (tx) {
            const batch = yield* tx
              .select({ id: paymentAttempts.id })
              .from(paymentAttempts)
              .where(
                or(
                  eq(paymentAttempts.refundState, "required"),
                  and(
                    eq(paymentAttempts.refundState, "not_required"),
                    eq(paymentAttempts.provider, "nexi"),
                    eq(paymentAttempts.state, "paid"),
                    gte(paymentAttempts.createdAt, input.recentPaymentsSince)
                  )
                )
              )
              .orderBy(
                sql`${paymentAttempts.refundState} = 'required' desc`,
                sql`${paymentAttempts.refundCheckedAt} asc nulls first`,
                asc(paymentAttempts.updatedAt),
                asc(paymentAttempts.id)
              )
              .limit(input.limit)
              .for("update", { skipLocked: true });
            if (batch.length === 0) return [];
            return yield* tx
              .update(paymentAttempts)
              .set({ refundCheckedAt: input.checkedAt })
              .where(
                inArray(
                  paymentAttempts.id,
                  batch.map(({ id }) => id)
                )
              )
              .returning();
          })
        );
        if (claimed.length === 0) return [];

        const reservations = yield* db
          .select({
            id: workspaceReservations.id,
            correlationId: workspaceReservations.correlationId,
          })
          .from(workspaceReservations)
          .where(
            inArray(
              workspaceReservations.id,
              claimed.map(
                ({ workspaceReservationId }) => workspaceReservationId
              )
            )
          );
        const correlationIds = new Map(
          reservations.map(({ id, correlationId }) => [id, correlationId])
        );

        return claimed.flatMap((row) => {
          const attempt = toPaymentAttempt(row);
          const correlationId = correlationIds.get(row.workspaceReservationId);
          return correlationId && isNexiPaymentAttempt(attempt)
            ? [{ attempt, correlationId }]
            : [];
        });
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

      return { claimRefundChecks, recordRefund };
    })
  );
}
