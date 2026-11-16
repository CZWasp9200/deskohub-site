import "server-only";

import { Effect, Schema } from "effect";
import { CheckoutPaymentPageService } from "@/features/checkout/backend/checkout/checkout-payment-page.service";
import { locales } from "@/features/i18n";
import { readReservationAccessCookie } from "@/features/reservation/backend/reservation-access-cookie";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { getRequestCookies } from "@/shared/backend/utils/request-cookies";

const reopenPaymentPageInputSchema = Schema.Struct({
  orderId: workspaceReservationIdSchema,
  /** The status page's locale, as the status page reads the order in it. */
  locale: Schema.Literals(locales),
});

export const reopenPaymentPageSchema = Schema.toStandardSchemaV1(
  reopenPaymentPageInputSchema
);

export type ReopenPaymentPageInput = typeof reopenPaymentPageInputSchema.Type;

/**
 * Reopens the order's payment page for the visitor of its status page, who
 * may see the order through its access cookie. The page's payment returns to
 * that status page.
 */
export const reopenPaymentPageForVisitor = Effect.fn(
  "checkout.reopenPaymentPageForVisitor"
)(function* ({ locale, orderId }: ReopenPaymentPageInput) {
  const cookieStore = yield* getRequestCookies;
  const paymentPages = yield* CheckoutPaymentPageService;
  return yield* paymentPages.reopen({
    accessCookie: readReservationAccessCookie(cookieStore, orderId),
    locale,
    orderId,
  });
});
