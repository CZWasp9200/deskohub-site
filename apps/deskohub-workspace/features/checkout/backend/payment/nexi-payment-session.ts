import { randomUUID } from "node:crypto";
import {
  type ExternalAPIError,
  type HostedPaymentCustomer,
  type NetworkError,
  type NexiCorrelationId,
  type NexiOrderId,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { Effect, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import type { OrderId, OrderKind } from "@/features/order";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import { CheckoutAnalytics } from "../analytics/checkout-analytics.service";
import { CheckoutError } from "../checkout/checkout-error";
import { appendVercelPreviewProtectionBypass } from "../checkout/vercel-preview-protection-bypass";
import {
  isNexiPaymentAttempt,
  paymentAttemptLogFields,
} from "../repositories/payment-attempt.repository";
import { NexiAmountFromWorkspaceMoney } from "./nexi-amount.codec";
import { getNexiCurrencyOverride } from "./nexi-currency";
import type { PaymentAdmission } from "./order-payment-handler";
import {
  OrderPaymentHandlers,
  type PaymentAdmissionDetailsFor,
} from "./order-payment-handlers.service";

const generateNexiOrderId = (): NexiOrderId =>
  NexiOrderIdSchema.make(
    `D${BigInt(`0x${randomUUID().replaceAll("-", "")}`)
      .toString(36)
      .toUpperCase()}`
  );

const toCheckoutUrlError = (cause: WorkspaceUrlConfigError) =>
  Effect.fail(
    new CheckoutError({
      code: "checkout_failed",
      message: cause.message,
      cause,
    })
  );

const getCheckoutPayReturnUrl: (
  locale: Locale,
  orderId: OrderId,
  outcome?: "cancelled"
) => Effect.Effect<string, CheckoutError> = Effect.fn(
  "getCheckoutPayReturnUrl"
)(
  function* (locale, orderId, outcome) {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL(
          `/${locale}/checkout/pay/return/${orderId}`,
          origin
        );
        if (outcome) url.searchParams.set("outcome", outcome);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          code: "checkout_failed",
          message: "Payment checkout return URL could not be created.",
          cause,
        }),
    });
  },
  (effect) =>
    effect.pipe(Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError))
);

const getNotificationUrl: Effect.Effect<string, CheckoutError> = Effect.gen(
  function* () {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin;

    return yield* Effect.try({
      try: () => {
        const url = new URL("/api/webhooks/nexi", origin);
        appendVercelPreviewProtectionBypass(url);
        return url.toString();
      },
      catch: (cause) =>
        new CheckoutError({
          code: "checkout_failed",
          message: "Payment checkout notification URL could not be created.",
          cause,
        }),
    });
  }
).pipe(Effect.catchTag("WorkspaceUrlConfigError", toCheckoutUrlError));

const toNexiAmount = Schema.encodeEffect(NexiAmountFromWorkspaceMoney);

/** Starts Nexi for a prepared order using the lifecycle operations of its kind. */
export const startNexiPaymentSession = Effect.fn("startNexiPaymentSession")(
  function* <Kind extends OrderKind, PrepareError>(
    input: PaymentAdmission<PaymentAdmissionDetailsFor<Kind>> & {
      readonly kind: Kind;
      readonly correlationId: NexiCorrelationId;
      readonly customer: HostedPaymentCustomer;
      readonly beforeAttempt: Effect.Effect<void, PrepareError>;
    }
  ) {
    const { byKind } = yield* OrderPaymentHandlers;
    const nexi = yield* NexiService;
    const analytics = yield* CheckoutAnalytics;
    const handler = byKind[input.kind];
    if (!handler) {
      return yield* new CheckoutError({
        code: "checkout_failed",
        message: "The order kind does not support payment.",
      });
    }
    const providerOrderId = generateNexiOrderId();
    const nexiCurrency = getNexiCurrencyOverride();
    const nexiAmount = yield* toNexiAmount(
      nexiCurrency ? { ...input.amount, currency: nexiCurrency } : input.amount
    ).pipe(
      Effect.mapError(
        (cause) =>
          new CheckoutError({
            code: "checkout_failed",
            message: "Unsupported payment amount.",
            cause,
          })
      )
    );
    const notificationUrl = yield* getNotificationUrl;
    const resultUrl = yield* getCheckoutPayReturnUrl(
      input.locale,
      input.orderId
    );
    const cancelUrl = yield* getCheckoutPayReturnUrl(
      input.locale,
      input.orderId,
      "cancelled"
    );
    yield* Effect.annotateLogsScoped({
      nexiAmount: nexiAmount.amount,
      nexiCurrency: nexiAmount.currency,
    });
    yield* Effect.logDebug("Checkout provider session inputs prepared");

    yield* input.beforeAttempt;

    // Once the attempt exists, finish creating and attaching its hosted
    // page even when the action deadline passes. Nexi has no idempotency
    // key, so cutting the request off would leave an ambiguous `created`
    // attempt; the Nexi request timeout still bounds this section.
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const attempt = yield* handler.admitNexi({
          orderId: input.orderId,
          amount: input.amount,
          locale: input.locale,
          details: input.details,
          providerOrderId,
        });
        if (!isNexiPaymentAttempt(attempt)) {
          return yield* new CheckoutError({
            code: "checkout_failed",
            message: "Nexi payment attempt configuration is invalid.",
          });
        }
        yield* Effect.annotateLogsScoped(paymentAttemptLogFields(attempt));
        yield* Effect.logInfo("Checkout payment attempt created");

        yield* Effect.logInfo("Nexi hosted payment page creation started");
        const hostedPaymentPage = yield* nexi
          .createHostedPaymentPage({
            orderId: attempt.providerOrderId,
            correlationId: input.correlationId,
            amount: nexiAmount.amount,
            currency: nexiAmount.currency,
            locale: input.locale,
            notificationUrl,
            resultUrl,
            cancelUrl,
            customer: input.customer,
          })
          .pipe(
            Effect.tapError(
              Effect.fnUntraced(function* (cause) {
                if (!isDefinitiveHostedPaymentPageFailure(cause)) {
                  yield* Effect.logError(
                    "Ambiguous hosted payment page creation failure retained the active attempt",
                    {
                      orderId: input.orderId,
                      paymentAttemptId: attempt.id,
                      errorTag: cause._tag,
                    }
                  );
                  return;
                }
                const transition = yield* handler.markTerminal({
                  id: attempt.id,
                  orderId: input.orderId,
                  state: "failed",
                  failureCode: "nexi_hpp_create_failed",
                  providerStatus: "hpp_create_failed",
                });
                if (transition.changed) {
                  yield* analytics.paymentFailed({
                    attempt: transition.attempt,
                    failureReason: "nexi_hpp_create_failed",
                    timestamp: transition.timestamp,
                  });
                }
              })
            )
          );
        // Not the page itself: its URL and security token are secrets.
        yield* Effect.annotateLogsScoped({
          providerOrderId: hostedPaymentPage.orderId,
        });
        yield* Effect.logInfo("Nexi hosted payment page creation completed");

        yield* Effect.logInfo("Checkout hosted payment page attach started");
        const attachedAttempt = yield* handler
          .attachProviderSession({
            id: attempt.id,
            securityToken: hostedPaymentPage.securityToken,
            providerRedirectUrl: hostedPaymentPage.hostedPage,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logError("Checkout hosted payment page attach failed", {
                ...paymentAttemptLogFields(attempt),
                cause,
              })
            )
          );
        return { attachedAttempt, hostedPaymentPage };
      })
    );
  }
);

const isDefinitiveHostedPaymentPageFailure = (
  cause: ExternalAPIError | NetworkError
) =>
  cause._tag === "ExternalAPIError" &&
  cause.statusCode !== undefined &&
  cause.statusCode >= 400 &&
  cause.statusCode < 500 &&
  ![408, 409, 425, 429].includes(cause.statusCode);
