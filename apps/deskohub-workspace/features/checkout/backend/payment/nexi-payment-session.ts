import { randomUUID } from "node:crypto";
import {
  type ExternalAPIError,
  type HostedPaymentCustomer,
  type NetworkError,
  type NexiCorrelationId,
  type NexiOrderId,
  NexiOrderIdSchema,
  type NexiService,
} from "@deskohub/nexi";
import { Effect, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import type { Money } from "@/shared/money/money";
import { CheckoutError } from "../checkout/checkout-error";
import { appendVercelPreviewProtectionBypass } from "../checkout/vercel-preview-protection-bypass";
import {
  isNexiPaymentAttempt,
  type PaymentAttempt,
  paymentAttemptLogFields,
} from "../repositories/payment-attempt.repository";
import type { IPaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { NexiAmountFromWorkspaceMoney } from "./nexi-amount.codec";
import { getNexiCurrencyOverride } from "./nexi-currency";

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
  function* <PrepareError, CreateError, FailureError>(
    nexi: Pick<NexiService["Service"], "createHostedPaymentPage">,
    input: {
      readonly orderId: OrderId;
      readonly correlationId: NexiCorrelationId;
      readonly locale: Locale;
      readonly amount: Money;
      readonly customer: HostedPaymentCustomer;
      readonly beforeAttempt: Effect.Effect<void, PrepareError>;
      readonly createAttempt: (
        providerOrderId: NexiOrderId
      ) => Effect.Effect<PaymentAttempt, CreateError>;
      readonly onCreationFailure: (input: {
        readonly cause: ExternalAPIError | NetworkError;
        readonly attempt: PaymentAttempt;
      }) => Effect.Effect<void, FailureError>;
      readonly attachProviderSession: IPaymentLifecycleRepository["attachProviderSession"];
    }
  ) {
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
        const attempt = yield* input.createAttempt(providerOrderId);
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
            Effect.tapError((cause) =>
              input.onCreationFailure({ cause, attempt })
            )
          );
        // Not the page itself: its URL and security token are secrets.
        yield* Effect.annotateLogsScoped({
          providerOrderId: hostedPaymentPage.orderId,
        });
        yield* Effect.logInfo("Nexi hosted payment page creation completed");

        yield* Effect.logInfo("Checkout hosted payment page attach started");
        const attachedAttempt = yield* input
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
