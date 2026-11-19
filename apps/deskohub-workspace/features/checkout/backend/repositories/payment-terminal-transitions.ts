import type { NexiOperationId, NexiWebhookEventId } from "@deskohub/nexi";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { DiscountClaimError } from "@/features/discounts/errors";
import { PromotionClaims } from "@/features/discounts/promotion-claims";
import type { OrderId } from "@/features/order";
import { ReferralInvitationLedger } from "@/features/referrals/referral-invitation-ledger";
import { reservationIdForOrder } from "@/features/reservation/persistence-contracts";
import { toPaymentAttempt } from "./payment-attempt.repository";
import { markPaymentAttemptTerminal } from "./payment-attempt-writes";
import {
  findPaymentReservationCustomer,
  lifecycleStateError,
  type NonTerminalPaymentAttemptState,
  type PaymentLifecycleStateError,
  type PaymentLifecycleTransition,
} from "./payment-lifecycle-state";

export interface IPaymentTerminalTransitions {
  /**
   * Ends an unpaid attempt and its held reservation's payment as failed,
   * cancelled or expired, and releases the attempt's discount-code, voucher
   * and referral invitation claims. Repeating the same terminal state is a
   * no-op that reports `changed: false`; any other attempt or reservation
   * state fails with `PaymentLifecycleStateError`.
   */
  readonly markTerminal: (input: {
    readonly id: PaymentAttemptId;
    readonly orderId: OrderId;
    readonly state: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly providerOperationId?: NexiOperationId;
    readonly providerStatus?: string;
    /**
     * Non-terminal attempt states the transition may start from; defaults to
     * both. Pass `["created"]` to end an attempt only while no provider
     * session has been attached to it.
     */
    readonly fromAttemptStates?: readonly NonTerminalPaymentAttemptState[];
  }) => Effect.Effect<
    PaymentLifecycleTransition,
    DatabaseQueryError | DiscountClaimError | PaymentLifecycleStateError
  >;
}

/**
 * The payment lifecycle's terminal transition as its own module, so the
 * interface needs nothing but the Workspace database: no accounting storage
 * and no application environment. `PaymentLifecycleRepository` composes it
 * behind its own `markTerminal`, and the E2E sandbox restart runs it directly
 * against the preview database.
 */
export class PaymentTerminalTransitions extends Context.Service<
  PaymentTerminalTransitions,
  IPaymentTerminalTransitions
>()("@deskohub-workspace/checkout/PaymentTerminalTransitions") {
  static Default: Layer.Layer<
    PaymentTerminalTransitions,
    never,
    WorkspaceDatabase
  > = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const markTerminal = Effect.fn("PaymentTerminalTransitions.markTerminal")(
        function* (
          input: Parameters<IPaymentTerminalTransitions["markTerminal"]>[0]
        ) {
          const workspaceReservationId = reservationIdForOrder(input.orderId);
          const terminalAt = Temporal.Now.instant();
          const fromAttemptStates = input.fromAttemptStates ?? [
            "created",
            "pending",
          ];

          return yield* transaction(
            Effect.gen(function* () {
              const dotyposCustomerId = yield* findPaymentReservationCustomer(
                "markTerminal",
                workspaceReservationId
              );
              yield* ReferralInvitationLedger.lockFirstBooking({
                dotyposCustomerId,
                records: "nothing",
              });

              const attempt = yield* markPaymentAttemptTerminal({
                ...input,
                fromAttemptStates,
                terminalAt,
              });

              if (!attempt) {
                return yield* lifecycleStateError(
                  "markTerminal",
                  { type: "paymentAttemptId", id: input.id },
                  "Only a non-terminal or matching terminal attempt can mark a reservation terminal."
                );
              }

              const [reservation] = yield* db
                .update(workspaceReservations)
                .set({
                  paymentState: input.state,
                  failureCode: input.failureCode,
                  updatedAt: terminalAt,
                })
                .where(
                  and(
                    eq(workspaceReservations.id, workspaceReservationId),
                    eq(workspaceReservations.reservationState, "held"),
                    eq(workspaceReservations.paymentState, "pending"),
                    eq(workspaceReservations.activePaymentAttemptId, input.id)
                  )
                )
                .returning({ updatedAt: workspaceReservations.updatedAt });

              if (reservation) {
                yield* PromotionClaims.release({
                  paymentAttemptId: input.id,
                  releasedAt: terminalAt,
                  releaseReason: input.failureCode,
                });
                yield* ReferralInvitationLedger.release({
                  paymentAttemptId: input.id,
                  releasedAt: terminalAt,
                  releaseReason: input.failureCode,
                });
                return {
                  attempt: toPaymentAttempt(attempt),
                  changed: true,
                  timestamp: reservation.updatedAt,
                };
              }

              const [consistent] = yield* db
                .select({ updatedAt: workspaceReservations.updatedAt })
                .from(workspaceReservations)
                .where(
                  and(
                    eq(workspaceReservations.id, workspaceReservationId),
                    eq(workspaceReservations.paymentState, input.state),
                    eq(workspaceReservations.activePaymentAttemptId, input.id)
                  )
                )
                .limit(1);

              if (!consistent) {
                return yield* lifecycleStateError(
                  "markTerminal",
                  { type: "paymentAttemptId", id: input.id },
                  "Only the active pending attempt on a held reservation can mark payment terminal."
                );
              }

              yield* PromotionClaims.release({
                paymentAttemptId: input.id,
                releasedAt: terminalAt,
                releaseReason: input.failureCode,
              });
              yield* ReferralInvitationLedger.release({
                paymentAttemptId: input.id,
                releasedAt: terminalAt,
                releaseReason: input.failureCode,
              });
              return {
                attempt: toPaymentAttempt(attempt),
                changed: false,
                timestamp: consistent.updatedAt,
              };
            })
          );
        }
      );

      return { markTerminal } satisfies IPaymentTerminalTransitions;
    })
  );
}
