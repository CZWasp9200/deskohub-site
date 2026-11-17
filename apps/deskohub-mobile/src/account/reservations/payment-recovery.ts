import type {
  CustomerCheckout,
  CustomerPaymentPageClosedReason,
  CustomerPaymentRetryDetails,
  CustomerPaymentRetryRefusedReason,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Data, Effect, Option } from "effect";
import { Platform } from "react-native";
import type { CheckoutRetryKind } from "../../booking/checkout/booking-problem";
import { bookingProblem } from "../../booking/checkout/booking-problem";
import {
  checkoutFailure,
  checkoutReturnTarget,
} from "../../booking/checkout/checkout-commands";
import { retryKind } from "../../booking/checkout/checkout-machine";
import { paymentBrowserLayer } from "../../booking/payment-browser";
import {
  appPaymentReturnUrl,
  PaymentBrowser,
  type PaymentBrowserResult,
} from "../../booking/payment-browser.service";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerWrite } from "../../customer-api/customer-request";
import type { AppLocale } from "../../i18n/app-locale";

/**
 * What an order books, for Book again or a retry: the order's own
 * selection, else its reservation's in the saved list. A failed payment's
 * order has released its hold and no longer says what it books.
 */
export const bookedSelectionOf = <Selection>(
  order: { readonly bookedSelection?: Selection | undefined },
  reservation: Option.Option<{
    readonly bookedSelection?: Selection | undefined;
  }>
): Selection | undefined =>
  order.bookedSelection ?? Option.getOrUndefined(reservation)?.bookedSelection;

/** How reopening the payment page ended. */
export type PaymentPageOutcome = Data.TaggedEnum<{
  /** The page opened and the customer came back from it. */
  Opened: { readonly result: PaymentBrowserResult };
  /** The page can't be opened any more; the order's status tells why. */
  Closed: { readonly reason: CustomerPaymentPageClosedReason };
  /** The order isn't the account's (any more). */
  NotFound: Record<never, never>;
}>;
export const PaymentPageOutcome = Data.taggedEnum<PaymentPageOutcome>();

/** How asking to pay a failed, cancelled or expired order again ended. */
export type PaymentRetryOutcome = Data.TaggedEnum<{
  /**
   * The same order's checkout and the details it keeps: confirm the terms
   * and pay.
   */
  Checkout: {
    readonly checkout: CustomerCheckout;
    readonly details: CustomerPaymentRetryDetails;
  };
  /** The earlier payment may still settle: check again later, never book again. */
  CheckLater: Record<never, never>;
  /** This order can't be paid any more: book the same selection again. */
  BookAgain: { readonly reason: CustomerPaymentRetryRefusedReason };
  NotFound: Record<never, never>;
}>;
export const PaymentRetryOutcome = Data.taggedEnum<PaymentRetryOutcome>();

/** What a refused retry leaves the customer to do. */
export const paymentRetryRefusal = (
  reason: CustomerPaymentRetryRefusedReason
): PaymentRetryOutcome =>
  reason === "payment_settling"
    ? PaymentRetryOutcome.CheckLater()
    : PaymentRetryOutcome.BookAgain({ reason });

/**
 * A request that failed without an answer to act on (unavailable service,
 * connection, budget, session, payment browser), as the checkout words it.
 */
export class PaymentRecoveryFailed extends Data.TaggedError(
  "PaymentRecoveryFailed"
)<{ readonly kind: CheckoutRetryKind }> {}

const recoveryFailed = (
  failure: Parameters<typeof checkoutFailure>[0]
): PaymentRecoveryFailed =>
  new PaymentRecoveryFailed({
    kind: retryKind(bookingProblem(checkoutFailure(failure))),
  });

const reservationsApi = Effect.map(
  Effect.service(CustomerApi),
  (api) => api.reservations
);

/**
 * Opens the order's unpaid payment page again (POST payment-page) in the
 * payment browser, returning to the app's status screen for the order.
 */
export const reopenPaymentPage = (orderId: CustomerReservationOrderId) =>
  reservationsApi.pipe(
    Effect.flatMap((reservations) =>
      reservations
        .reopenPaymentPage({
          params: { orderId },
          payload: { returnTarget: checkoutReturnTarget(Platform.OS) },
        })
        .pipe(customerWrite)
    ),
    Effect.flatMap(({ url }) =>
      Effect.flatMap(Effect.service(PaymentBrowser), (browser) =>
        browser.open(url, appPaymentReturnUrl(orderId))
      )
    ),
    Effect.map((result) => PaymentPageOutcome.Opened({ result })),
    Effect.catchTags({
      CustomerPaymentPageClosed: ({ reason }) =>
        Effect.succeed(PaymentPageOutcome.Closed({ reason })),
      CustomerReservationNotFound: () =>
        Effect.succeed(PaymentPageOutcome.NotFound()),
    }),
    Effect.mapError(recoveryFailed)
  );

/**
 * Asks to pay the order again in place (POST payment-retry): its checkout
 * with the details kept, or why it can't be paid again.
 */
export const retryPayment = (
  orderId: CustomerReservationOrderId,
  locale: AppLocale
) =>
  reservationsApi.pipe(
    Effect.flatMap((reservations) =>
      reservations
        .retryPayment({ params: { orderId }, payload: { locale } })
        .pipe(customerWrite)
    ),
    Effect.map(({ details, ...checkout }) =>
      PaymentRetryOutcome.Checkout({ checkout, details })
    ),
    Effect.catchTags({
      CustomerPaymentRetryRefused: ({ reason }) =>
        Effect.succeed(paymentRetryRefusal(reason)),
      CustomerReservationNotFound: () =>
        Effect.succeed(PaymentRetryOutcome.NotFound()),
    }),
    Effect.mapError(recoveryFailed)
  );

export const reopenPaymentPageAtom = customerDataRuntime.fn(
  (orderId: CustomerReservationOrderId) =>
    reopenPaymentPage(orderId).pipe(Effect.provide(paymentBrowserLayer))
);

export const retryPaymentAtom = customerDataRuntime.fn(
  ({
    orderId,
    locale,
  }: {
    readonly orderId: CustomerReservationOrderId;
    readonly locale: AppLocale;
  }) => retryPayment(orderId, locale)
);
