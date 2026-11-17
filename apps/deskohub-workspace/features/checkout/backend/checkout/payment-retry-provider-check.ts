import {
  isDeclinedNexiPaymentOperation,
  type NexiOrder,
  NexiService,
} from "@deskohub/nexi";
import { Context, Effect, Layer } from "effect";
import { hasProviderPaymentActivity } from "@/features/checkout/provider-order-abandonment";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import type { PaymentAttempt } from "../repositories/payment-attempt.repository";
import { PaymentRetryUnavailableError } from "./payment-retry-unavailable";

/**
 * What the provider says about the payment a retry would replace:
 * - `ended_unpaid`: no amount was authorized or captured, and every
 *   operation is a declined or abandoned authorization or capture (or there
 *   is none). Its page may still be open when it has no operation; a payment
 *   made there after the retry's own is refunded by late-payment recovery.
 * - `may_settle`: any other operation (a payment under way or done, a void,
 *   a refund, one of unknown type or result) or any amount: money may move,
 *   so no retry starts.
 * - `no_provider_order`: the attempt names no provider order, which a
 *   payment attempt that reached its terminal state never lacks.
 */
export type PaymentRetryProviderState =
  | "ended_unpaid"
  | "may_settle"
  | "no_provider_order";

const getProviderState = (order: NexiOrder): PaymentRetryProviderState =>
  order.operations.every(isDeclinedNexiPaymentOperation) &&
  !hasProviderPaymentActivity({
    operationCount: 0,
    authorizedAmount: order.authorizedAmount,
    capturedAmount: order.capturedAmount,
  })
    ? "ended_unpaid"
    : "may_settle";

interface IPaymentRetryProviderCheck {
  /**
   * Asks the provider, now, whether the attempt's payment ended without
   * moving money. A lookup that fails fails the check, so a retry never
   * starts on a payment nobody could read.
   */
  readonly check: (input: {
    readonly attempt: Pick<PaymentAttempt, "providerOrderId">;
    readonly reservation: Pick<WorkspaceReservation, "correlationId">;
  }) => Effect.Effect<PaymentRetryProviderState, PaymentRetryUnavailableError>;
}

/**
 * The provider gate in front of every payment retry. It is the one place
 * that decides, so cancelling the provider's page first can replace it.
 */
export class PaymentRetryProviderCheck extends Context.Service<
  PaymentRetryProviderCheck,
  IPaymentRetryProviderCheck
>()("@deskohub-workspace/checkout/PaymentRetryProviderCheck") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const nexi = yield* NexiService;
      return PaymentRetryProviderCheck.of({
        check: Effect.fn("PaymentRetryProviderCheck.check")(function* ({
          attempt,
          reservation,
        }) {
          if (!attempt.providerOrderId) return "no_provider_order" as const;
          const order = yield* nexi
            .getOrder({
              orderId: attempt.providerOrderId,
              correlationId: reservation.correlationId,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new PaymentRetryUnavailableError({
                    message: "The payment provider could not be asked.",
                    cause,
                  })
              )
            );
          const state = getProviderState(order);
          // Operation types and results only; never ids or tokens.
          yield* Effect.logInfo("Payment retry provider state read", {
            state,
            lastOperationType: order.lastOperationType,
            operations: order.operations.map(
              ({ operationType, operationResult }) =>
                `${operationType ?? "?"}:${operationResult ?? "?"}`
            ),
          });
          return state;
        }),
      });
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceNexiLayer));
}
