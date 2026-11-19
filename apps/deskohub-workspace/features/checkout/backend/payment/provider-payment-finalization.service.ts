import {
  classifyNexiFailureStatus,
  type ExternalAPIError,
  getNexiPaymentMetadata,
  type NetworkError,
  type NexiCurrency,
  NexiCurrencySchema,
  type NexiPaymentMetadata,
  NexiService,
  type NexiWebhookEventId,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
  type Scope,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { OrderId } from "@/features/order";
import { WorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import {
  getProviderOrderAbandonment,
  getProviderOrderAbandonmentCutoff,
  hasProviderPaymentActivity,
} from "../../provider-order-abandonment";
import { CheckoutAnalytics } from "../analytics/checkout-analytics.service";
import {
  isNexiPaymentAttempt,
  type NexiPaymentAttempt,
  type PaymentAttempt,
  PaymentAttemptRepository,
  paymentAttemptLogFields,
} from "../repositories/payment-attempt.repository";
import type { PaymentLifecycleRepositoryError } from "../repositories/payment-lifecycle.repository";
import { getNexiCurrencyOverride } from "./nexi-currency";
import type {
  OrderPaymentHandler,
  PaymentOrder,
} from "./order-payment-handler";
import { OrderPaymentHandlers } from "./order-payment-handlers.service";
import { paymentVerificationLogFields } from "./payment-verification-log-fields";
import {
  isVerifiableNexiPaymentAttempt,
  type VerifiableNexiPaymentAttempt,
} from "./verifiable-nexi-payment-attempt";

/**
 * An operation-free provider order, or an unattached session, still inside
 * its abandonment window. Nothing can resolve it before `abandonmentCutoff`.
 */
export class ProviderPaymentDeferral extends Data.TaggedClass(
  "ProviderPaymentDeferral"
)<{
  readonly abandonmentCutoff: Temporal.Instant;
}> {}

export type ProviderPaymentFinalizationResult =
  | "abandoned"
  | ProviderPaymentDeferral
  | "not_found"
  | "not_pending"
  | "not_verifiable"
  | "provider_verification_failed"
  | "verification_mismatch"
  | "awaiting_payment"
  | "pending"
  | "paid"
  | "terminal";

/**
 * A finalization result for log annotations: its outcome, and the
 * abandonment cutoff of a deferral.
 */
export const providerPaymentFinalizationLogFields = (
  result: ProviderPaymentFinalizationResult
) =>
  result instanceof ProviderPaymentDeferral
    ? {
        providerFinalizationResult: "deferred",
        abandonmentCutoff: result.abandonmentCutoff.toString(),
      }
    : { providerFinalizationResult: result, abandonmentCutoff: undefined };

/**
 * A finalization request for log annotations: the ids it names, when it
 * checks for abandonment, and its verification deadline in milliseconds.
 */
const providerPaymentFinalizationInputLogFields = (
  input: Parameters<
    IProviderPaymentFinalizationService["finalizePendingProviderPayment"]
  >[0]
) => ({
  orderId: input.orderId,
  paymentAttemptId: input.paymentAttemptId,
  webhookEventId: input.webhookEventId,
  abandonmentCheckedAt: input.abandonmentCheckedAt?.toString(),
  verificationDeadlineMillis:
    input.verificationDeadline === undefined
      ? undefined
      : Duration.toMillis(input.verificationDeadline),
});

export interface IProviderPaymentFinalizationService {
  readonly finalizePendingProviderPayment: (input: {
    readonly orderId: OrderId;
    readonly paymentAttemptId?: PaymentAttemptId;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly abandonmentCheckedAt?: Temporal.Instant;
    /** Bounds the Nexi payment verification, retries included. */
    readonly verificationDeadline?: Duration.Input;
  }) => Effect.Effect<
    ProviderPaymentFinalizationResult,
    PaymentLifecycleRepositoryError
  >;
}

export class ProviderPaymentFinalizationService extends Context.Service<
  ProviderPaymentFinalizationService,
  IProviderPaymentFinalizationService
>()("ProviderPaymentFinalizationService") {
  static Default = makeProviderPaymentFinalizationServiceLayer(this);

  static Live = this.Default.pipe(
    Layer.provide(PaymentAttemptRepository.Default),
    Layer.provide(OrderPaymentHandlers.Live),
    Layer.provide(CheckoutAnalytics.Live),
    Layer.provide(WorkspaceDatabase.Default),
    Layer.provide(WorkspaceNexiLayer)
  );
}

function makeProviderPaymentFinalizationServiceLayer(
  service: typeof ProviderPaymentFinalizationService
) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const handlers = yield* OrderPaymentHandlers;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const nexi = yield* NexiService;
      const checkoutAnalytics = yield* CheckoutAnalytics;

      /**
       * Ends an attempt whose hosted payment page creation failed ambiguously
       * and never attached a provider session. Nexi documents no idempotency
       * key for hosted page creation and its order lookup returns no hosted
       * page, so the original session cannot be recovered. It is also
       * unpayable: only an attached session's hosted page reaches the
       * customer. Hold cleanup fails it after the abandonment window unless
       * the provider order unexpectedly shows payment activity.
       */
      const resolveUnattachedProviderSession = Effect.fn(
        "providerPaymentFinalization.resolveUnattachedProviderSession"
      )(function* (input: {
        readonly order: PaymentOrder;
        readonly handler: OrderPaymentHandler;
        readonly attempt: NexiPaymentAttempt;
        readonly checkedAt: Temporal.Instant | undefined;
      }): Effect.fn.Return<
        ProviderPaymentFinalizationResult,
        PaymentLifecycleRepositoryError
      > {
        if (!input.checkedAt) {
          yield* Effect.logWarning(
            "Payment finalization left an unattached provider session for hold cleanup"
          );
          return "not_verifiable";
        }
        const abandonmentCutoff = getProviderOrderAbandonmentCutoff(
          input.attempt.createdAt
        );
        if (Temporal.Instant.compare(input.checkedAt, abandonmentCutoff) < 0) {
          yield* Effect.logInfo(
            "Payment finalization deferred an unattached provider session"
          );
          return new ProviderPaymentDeferral({ abandonmentCutoff });
        }

        const providerOrder = yield* nexi
          .getOrder({
            orderId: input.attempt.providerOrderId,
            correlationId: input.order.correlationId,
          })
          .pipe(
            Effect.map(Option.some),
            Effect.catchIf(isProviderOrderNotFound, () => Effect.succeedNone),
            Effect.tapError((cause) =>
              Effect.logError(
                "Unattached provider session order lookup failed",
                { cause }
              )
            ),
            Effect.option
          );
        if (Option.isNone(providerOrder)) {
          return "provider_verification_failed";
        }
        if (
          Option.isSome(providerOrder.value) &&
          hasProviderPaymentActivity({
            operationCount: providerOrder.value.value.operations.length,
            authorizedAmount: providerOrder.value.value.authorizedAmount,
            capturedAmount: providerOrder.value.value.capturedAmount,
          })
        ) {
          yield* Effect.logError(
            "Unattached provider session has payment activity and needs operator review"
          );
          return "not_verifiable";
        }

        const terminal = yield* input.handler
          .markTerminal({
            id: input.attempt.id,
            orderId: input.order.id,
            state: "failed",
            failureCode: "nexi_hpp_create_unconfirmed",
            providerStatus: "hpp_create_unconfirmed",
            fromAttemptStates: ["created"],
          })
          .pipe(
            Effect.catchTag(
              "PaymentLifecycleStateError",
              Effect.fn(function* (cause) {
                yield* Effect.logWarning(
                  "Unattached provider session changed before it could fail",
                  { cause }
                );
                return undefined;
              })
            )
          );
        if (!terminal) return "not_pending";

        if (terminal.changed) {
          yield* checkoutAnalytics.paymentFailed({
            attempt: terminal.attempt,
            failureReason: "nexi_hpp_create_unconfirmed",
            timestamp: terminal.timestamp,
          });
        }
        yield* Effect.logInfo(
          "Payment finalization failed an unattached provider session",
          { providerOrderFound: Option.isSome(providerOrder.value) }
        );
        return "terminal";
      });

      const loadOrder = Effect.fnUntraced(
        function* (orderId: OrderId) {
          const handler = yield* handlers.forOrder(orderId);
          if (!handler) return null;
          const order = yield* handler.load(orderId);
          return order ? { order, handler } : null;
        },
        (effect, orderId) =>
          effect.pipe(
            Effect.tapError((cause) =>
              Effect.logError("Payment finalization order lookup failed", {
                orderId,
                cause,
              })
            ),
            Effect.orElseSucceed(() => null)
          )
      );

      /** An order whose payment already left `pending`. */
      const resolveSettledOrder = Effect.fnUntraced(function* (
        order: PaymentOrder,
        handler: OrderPaymentHandler
      ) {
        const progress = settledOrderProgress(order);
        if (progress === "fulfillment_stalled") {
          // Safety net for a paid order whose webhook fulfillment
          // stalled. The queue dedupes per order, so repeated status
          // refreshes enqueue at most one message.
          yield* Effect.logWarning(
            "Payment finalization enqueueing fulfillment for already-paid order"
          );
          yield* handler.scheduleFulfillment({ orderId: order.id });
          return "paid" as const;
        }
        if (progress === "fulfilled") {
          yield* Effect.logInfo(
            "Payment finalization returned paid for fulfilled order"
          );
          return "paid" as const;
        }

        yield* Effect.logInfo("Payment finalization returned not_pending");
        return "not_pending" as const;
      });

      const loadPaymentAttempt = Effect.fnUntraced(function* (
        orderId: OrderId,
        paymentAttemptId: PaymentAttemptId
      ) {
        const attempt = yield* paymentAttempts.findById(paymentAttemptId).pipe(
          Effect.tapError((cause) =>
            Effect.logError("Payment finalization attempt lookup failed", {
              orderId,
              paymentAttemptId,
              cause,
            })
          ),
          Effect.orElseSucceed(() => null)
        );
        yield* Effect.annotateLogsScoped({
          ...paymentAttemptLogFields(attempt),
          paymentAttemptId,
        });
        yield* Effect.logDebug("Payment finalization attempt lookup completed");
        return attempt;
      });

      const decodeAttemptCurrency = Effect.fnUntraced(function* (
        verifiable: VerifiableAttemptFinalization
      ) {
        const { input, order, attempt } = verifiable;
        const currency = yield* Schema.decodeUnknownEffect(NexiCurrencySchema)(
          attempt.amount.currency
        ).pipe(
          Effect.tapError((cause) =>
            Effect.logError("Payment finalization currency decode failed", {
              input,
              orderId: order.id,
              ...paymentAttemptLogFields(attempt),
              cause,
            })
          ),
          Effect.orElseSucceed(() => undefined)
        );
        yield* Effect.annotateLogsScoped({ currency });
        yield* Effect.logDebug("Payment finalization currency decoded");
        return currency;
      });

      const verifyProviderPayment = Effect.fnUntraced(function* (
        { input, order, attempt }: VerifiableAttemptFinalization,
        currency: NexiCurrency
      ) {
        yield* Effect.logInfo(
          "Payment finalization provider verification started"
        );
        const verification = yield* nexi
          .verifyPaymentOutcome({
            orderId: attempt.providerOrderId,
            correlationId: order.correlationId,
            amount: String(attempt.amount.value),
            currency: getNexiCurrencyOverride() ?? currency,
            securityToken: attempt.securityToken,
            deadline: input.verificationDeadline,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logError("Nexi payment outcome verification failed", {
                orderId: order.id,
                paymentAttemptId: attempt.id,
                providerOrderId: attempt.providerOrderId,
                cause,
              })
            ),
            Effect.orElseSucceed(() => undefined)
          );

        yield* Effect.annotateLogsScoped(
          paymentVerificationLogFields(verification)
        );
        yield* Effect.logInfo(
          "Payment finalization provider verification completed"
        );
        return verification;
      });

      const markVerifiedPaymentPaid = Effect.fnUntraced(function* (
        { input, order, handler, attempt }: VerifiableAttemptFinalization,
        { providerOperationId, providerStatus }: NexiPaymentMetadata
      ) {
        yield* Effect.logInfo("Payment finalization mark paid started");
        const paidSuccess = yield* handler
          .markPaid({
            id: attempt.id,
            orderId: order.id,
            webhookEventId: input.webhookEventId,
            providerOperationId,
            providerStatus,
            paidAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.catchTag(
              "PaymentLifecycleStateError",
              Effect.fn(function* (cause) {
                yield* Effect.logWarning(
                  "Payment finalization mark paid returned not_pending",
                  { cause }
                );
                return undefined;
              })
            )
          );

        if (!paidSuccess) {
          return "not_pending" as const;
        }
        if (paidSuccess.changed) {
          yield* checkoutAnalytics.paymentCompleted({
            attempt: paidSuccess.attempt,
            timestamp: paidSuccess.timestamp,
          });
        }
        yield* Effect.logDebug("Payment finalization mark paid completed");

        yield* handler.scheduleFulfillment({
          orderId: order.id,
          paymentAttemptId: attempt.id,
        });
        return "paid" as const;
      });

      const markVerifiedPaymentTerminal = Effect.fnUntraced(function* (
        { input, order, handler, attempt }: VerifiableAttemptFinalization,
        { providerOperationId, providerStatus }: NexiPaymentMetadata
      ) {
        const terminalState = classifyNexiFailureStatus(providerStatus);
        yield* Effect.annotateLogsScoped({
          failureKind: terminalState,
          terminalState,
        });

        yield* Effect.logInfo("Payment finalization mark terminal started");
        const terminalSuccess = yield* handler
          .markTerminal({
            id: attempt.id,
            orderId: order.id,
            state: terminalState,
            failureCode: "nexi_payment_failed",
            webhookEventId: input.webhookEventId,
            providerOperationId,
            providerStatus,
          })
          .pipe(
            Effect.catchTag(
              "PaymentLifecycleStateError",
              Effect.fn(function* (cause) {
                yield* Effect.logWarning(
                  "Payment finalization mark terminal returned not_pending",
                  { cause }
                );
                return undefined;
              })
            )
          );

        if (!terminalSuccess) {
          return "not_pending" as const;
        }
        if (terminalSuccess.changed) {
          if (terminalState === "failed") {
            yield* checkoutAnalytics.paymentFailed({
              attempt: terminalSuccess.attempt,
              failureReason: "nexi_payment_failed",
              timestamp: terminalSuccess.timestamp,
            });
          } else {
            yield* checkoutAnalytics.paymentAbandoned({
              attempt: terminalSuccess.attempt,
              timestamp: terminalSuccess.timestamp,
            });
          }
        }
        yield* Effect.logDebug("Payment finalization mark terminal completed");

        return "terminal" as const;
      });

      /** A verified provider order that is neither paid nor failed. */
      const resolvePendingProviderOrder = Effect.fnUntraced(function* (
        { input, attempt }: VerifiableAttemptFinalization,
        verification: PaymentVerificationResult
      ) {
        const emptyOrder = getProviderOrderAbandonment({
          checkedAt: input.abandonmentCheckedAt,
          providerOrderCreatedAt: attempt.providerOrderCreatedAt,
          order: verification.provider,
        });
        // Without an abandonment check, an operation-free order is still
        // waiting for the customer's payment on its page.
        if (
          !input.abandonmentCheckedAt &&
          !hasProviderPaymentActivity(verification.provider)
        ) {
          yield* Effect.logInfo(
            "Payment finalization returned awaiting_payment"
          );
          return "awaiting_payment" as const;
        }
        if (emptyOrder.state !== "not_empty") {
          yield* Effect.logInfo(
            "Payment finalization resolved empty provider order",
            { result: emptyOrder.state }
          );
          return Match.value(emptyOrder).pipe(
            Match.discriminatorsExhaustive("state")({
              abandoned: () => "abandoned" as const,
              deferred: ({ cutoff }) =>
                new ProviderPaymentDeferral({ abandonmentCutoff: cutoff }),
            })
          );
        }

        yield* Effect.logInfo("Payment finalization returned pending");
        return "pending" as const;
      });

      const finalizeVerifiableAttempt = Effect.fnUntraced(function* (
        verifiable: VerifiableAttemptFinalization
      ): Effect.fn.Return<
        ProviderPaymentFinalizationResult,
        PaymentLifecycleRepositoryError,
        Scope.Scope
      > {
        const currency = yield* decodeAttemptCurrency(verifiable);
        if (!currency) {
          yield* Effect.logWarning(
            "Payment finalization returned not_verifiable"
          );
          return "not_verifiable";
        }

        const verification = yield* verifyProviderPayment(verifiable, currency);
        if (!verification) {
          yield* Effect.logWarning(
            "Payment finalization returned provider_verification_failed"
          );
          return "provider_verification_failed";
        }
        if (verification.mismatches.length > 0) {
          yield* Effect.logWarning(
            "Payment finalization returned verification_mismatch"
          );
          return "verification_mismatch";
        }

        const metadata = getNexiPaymentMetadata(verification);
        yield* Effect.annotateLogsScoped({
          providerOperationId: metadata.providerOperationId,
          providerStatus: metadata.providerStatus,
        });
        yield* Effect.logDebug(
          "Payment finalization provider metadata resolved"
        );

        if (verification.status === "success") {
          return yield* markVerifiedPaymentPaid(verifiable, metadata);
        }
        if (verification.status === "failure") {
          return yield* markVerifiedPaymentTerminal(verifiable, metadata);
        }
        return yield* resolvePendingProviderOrder(verifiable, verification);
      });

      return ProviderPaymentFinalizationService.of({
        finalizePendingProviderPayment: Effect.fn(
          "providerPaymentFinalization.finalizePendingProviderPayment"
        )(
          function* (input) {
            yield* Effect.logInfo("Provider payment finalization started");

            const resolved = yield* loadOrder(input.orderId);
            const paymentAttemptId =
              input.paymentAttemptId ?? resolved?.order.activePaymentAttemptId;
            yield* Effect.annotateLogsScoped({
              ...resolved?.order.logFields,
              paymentAttemptId,
            });
            yield* Effect.logDebug(
              "Payment finalization order lookup completed"
            );

            if (!resolved || !paymentAttemptId) {
              yield* Effect.logInfo("Payment finalization returned not_found");
              return "not_found";
            }
            const { order, handler } = resolved;
            if (order.paymentState !== "pending") {
              return yield* resolveSettledOrder(order, handler);
            }

            const loadedAttempt = yield* loadPaymentAttempt(
              order.id,
              paymentAttemptId
            );
            const attempt =
              loadedAttempt?.orderId === order.id ? loadedAttempt : null;
            if (isUnattachedProviderSession(attempt)) {
              return yield* resolveUnattachedProviderSession({
                order,
                handler,
                attempt,
                checkedAt: input.abandonmentCheckedAt,
              });
            }
            if (!isVerifiableNexiPaymentAttempt(attempt)) {
              yield* Effect.logWarning(
                "Payment finalization returned not_verifiable"
              );
              return "not_verifiable";
            }

            return yield* finalizeVerifiableAttempt({
              input,
              order,
              handler,
              attempt,
            });
          },
          (effect, input) =>
            effect.pipe(
              Effect.scoped,
              Effect.tap((result) =>
                Effect.logInfo("Provider payment finalization completed", {
                  result,
                })
              ),
              Effect.annotateLogs(
                providerPaymentFinalizationInputLogFields(input)
              )
            )
        ),
      });
    })
  );
}

type ProviderPaymentFinalizationInput = Parameters<
  IProviderPaymentFinalizationService["finalizePendingProviderPayment"]
>[0];

interface VerifiableAttemptFinalization {
  readonly input: ProviderPaymentFinalizationInput;
  readonly order: PaymentOrder;
  readonly handler: OrderPaymentHandler;
  readonly attempt: VerifiableNexiPaymentAttempt;
}

/**
 * Where an order whose payment left `pending` stands: a paid order
 * whose fulfillment stalled, a paid order already delivered or delivering,
 * or neither.
 */
const settledOrderProgress = (
  order: Pick<PaymentOrder, "paymentState" | "fulfillmentState">
) => {
  if (order.paymentState !== "paid") return "not_pending";
  if (
    order.fulfillmentState === "not_started" ||
    order.fulfillmentState === "processing"
  ) {
    return "fulfillment_stalled";
  }
  if (
    order.fulfillmentState === "awaiting_delivery" ||
    order.fulfillmentState === "fulfilled"
  ) {
    return "fulfilled";
  }
  return "not_pending";
};

/** A Nexi attempt whose hosted payment page creation never attached a session. */
const isUnattachedProviderSession = (
  attempt: PaymentAttempt | null
): attempt is NexiPaymentAttempt => {
  if (!attempt || !isNexiPaymentAttempt(attempt)) return false;
  return attempt.state === "created" && !attempt.securityToken;
};

// Nexi documents 404 as "Order not found" for GET /orders/{orderId}.
const isProviderOrderNotFound = (error: ExternalAPIError | NetworkError) =>
  error._tag === "ExternalAPIError" && error.statusCode === 404;
