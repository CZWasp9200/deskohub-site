import "server-only";

import { Effect, Match, Schema } from "effect";
import {
  CheckoutPaymentRetryService,
  type PaymentRetryPreparation,
} from "@/features/checkout/backend/checkout/checkout-payment-retry.service";
import { locales } from "@/features/i18n";
import { readReservationAccessCookie } from "@/features/reservation/backend/reservation-access-cookie";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { getRequestCookies } from "@/shared/backend/utils/request-cookies";

const preparePaymentRetryInputSchema = Schema.Struct({
  orderId: workspaceReservationIdSchema,
  /** The status page's locale; the Pay page opens in it. */
  locale: Schema.Literals(locales),
});

export const preparePaymentRetrySchema = Schema.toStandardSchemaV1(
  preparePaymentRetryInputSchema
);

export type PreparePaymentRetryInput =
  typeof preparePaymentRetryInputSchema.Type;

/**
 * What the status page does next: open the Pay page of the same order,
 * say its spot was taken, refresh a payment that may still settle, or
 * offer booking the selection again for every other refusal.
 */
export type PaymentRetryStart =
  | { readonly state: "ready"; readonly payUrl: string }
  | { readonly state: "spot_unavailable" }
  | { readonly state: "payment_settling" }
  | { readonly state: "refused" };

const toPaymentRetryStart = (
  preparation: PaymentRetryPreparation
): PaymentRetryStart =>
  Match.value(preparation).pipe(
    Match.discriminatorsExhaustive("state")({
      ready: ({ payState }) => ({
        state: "ready" as const,
        payUrl: payState.freshPayUrl,
      }),
      spot_unavailable: () => ({ state: "spot_unavailable" as const }),
      payment_settling: () => ({ state: "payment_settling" as const }),
      not_retryable: () => ({ state: "refused" as const }),
      not_found: () => ({ state: "refused" as const }),
    })
  );

/**
 * Prepares paying the order again for the visitor of its status page, who
 * may see the order through its access cookie.
 */
export const preparePaymentRetryForVisitor = Effect.fn(
  "checkout.preparePaymentRetryForVisitor"
)(function* ({ locale, orderId }: PreparePaymentRetryInput) {
  const cookieStore = yield* getRequestCookies;
  const retries = yield* CheckoutPaymentRetryService;
  const preparation = yield* retries.prepare({
    accessCookie: readReservationAccessCookie(cookieStore, orderId),
    locale,
    orderId,
  });
  return toPaymentRetryStart(preparation);
});
