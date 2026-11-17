import "server-only";

import {
  CurrentCustomerSession,
  CustomerAccessCodeUnavailable,
  CustomerAccountLinkRequired,
  type CustomerBookedSelection,
  type CustomerEstablishment,
  CustomerInvoiceNotIssued,
  type CustomerOrderState,
  type CustomerPaymentPage,
  CustomerPaymentPageClosed,
  CustomerPaymentRetryRefused,
  type CustomerReservationAccess,
  type CustomerReservationHistory,
  CustomerReservationNotFound,
  type CustomerReservationSummary,
  CustomerSessionRequired,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Match } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  currentReservationHistoryAccount,
  type CustomerReservationHistory as ReservationHistoryRecord,
  type CustomerReservationSummary as ReservationSummaryRecord,
} from "@/features/account";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerReservationHistoryWithAccessService } from "@/features/account/backend/customer-reservation-history-with-access.service";
import { getReservationSummaryStay } from "@/features/account/reservation-summary-stay";
import { ReservationInvoicePdfService } from "@/features/accounting/backend/reservation-invoice-pdf.service";
import { loadAuthorizedCheckoutStatus } from "@/features/checkout/backend/checkout/authorized-checkout-status";
import {
  CheckoutPaymentPageService,
  type PaymentPageReopening,
} from "@/features/checkout/backend/checkout/checkout-payment-page.service";
import {
  CheckoutPaymentRetryService,
  type PaymentRetryPreparation,
} from "@/features/checkout/backend/checkout/checkout-payment-retry.service";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout/checkout-status.service";
import { defaultLocale } from "@/features/i18n";
import type { RebookingSelection } from "@/features/reservation/backend/booking-selection";
import {
  ReservationAccessService,
  type ReservationAccessViewModel,
} from "@/features/reservation/backend/reservation-access.service";
import { providePerRequest } from "@/shared/backend/provide-per-request";
import { runToCompletion } from "@/shared/backend/run-to-completion";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
  workspaceGoogleMapUrl,
} from "@/shared/utils/workspace-location-map";
import {
  answerCustomerApiFailure,
  answerSessionApiFailure,
  answerUnavailable,
} from "./customer-api-failure";
import { toCustomerCheckout } from "./customer-checkout-view";
import { answerFileDownload } from "./customer-file-download";
import { CustomerReservationLayers } from "./customer-reservation-layers";

/**
 * The reservations group's handlers. Each endpoint builds its operation's
 * Layers per request from `CustomerReservationLayers`, and answers every
 * failure with the contract's fixed public errors. An order the account may
 * not see is not found, exactly like one that doesn't exist. The API
 * presents only the session, never an emailed capability link, so
 * authorization ignores the locale it gets, the default.
 */
export const CustomerReservationsApiHandlers = HttpApiBuilder.group(
  WorkspaceCustomerApi,
  "reservations",
  Effect.fn(function* (handlers) {
    const reservations = yield* CustomerReservationLayers;
    // The authentication the session middleware read the request through.
    const authentication = Layer.succeed(
      CustomerAuthentication,
      yield* CustomerAuthentication
    );
    const authorization = reservations.authorization.pipe(
      Layer.provide(authentication)
    );
    const currentAccount = reservations.currentAccount.pipe(
      Layer.provide(authentication)
    );

    return (
      handlers
        // Showing today's door code can issue it at the lock provider and
        // store it, so the list ends even when the client disconnects.
        .handle("listReservations", ({ query: { locale = defaultLocale } }) =>
          Effect.flatMap(CurrentCustomerSession, (session) =>
            currentReservationHistoryAccount(session.accountId)
          ).pipe(
            Effect.flatMap((account) =>
              Effect.flatMap(
                CustomerReservationHistoryWithAccessService,
                (histories) => histories.load(account, { locale })
              )
            ),
            Effect.provide(
              Layer.mergeAll(
                currentAccount,
                reservations.history(authorization)
              )
            ),
            runToCompletion,
            answerCustomerApiFailure("customerApi.listReservations"),
            Effect.flatMap(answerReservationHistory)
          )
        )
        .handle("getEstablishment", () => Effect.succeed(establishment))
        // A refresh can finalize a payment, so it ends even when the client
        // disconnects.
        .handle("getReservationStatus", ({ params: { orderId } }) =>
          loadAuthorizedCheckoutStatus({
            orderId,
            locale: defaultLocale,
            returnOutcome: "unknown",
          }).pipe(
            providePerRequest(
              Layer.mergeAll(reservations.checkoutStatus, authorization)
            ),
            runToCompletion,
            answerSessionApiFailure("customerApi.getReservationStatus"),
            Effect.flatMap(answerOrderState)
          )
        )
        .handle("reopenPaymentPage", ({ params: { orderId }, payload }) =>
          Effect.flatMap(CheckoutPaymentPageService, (paymentPages) =>
            paymentPages.reopen({
              orderId,
              locale: defaultLocale,
              ...(payload.returnTarget !== undefined && {
                returnTarget: payload.returnTarget,
              }),
            })
          ).pipe(
            Effect.provide(reservations.paymentPage(authorization)),
            answerSessionApiFailure("customerApi.reopenPaymentPage"),
            Effect.flatMap(answerPaymentPage)
          )
        )
        // Securing the hold can book the spot again in Dotypos, so it ends
        // even when the client disconnects.
        .handle("retryPayment", ({ params: { orderId }, payload }) =>
          Effect.flatMap(CheckoutPaymentRetryService, (retries) =>
            retries.prepare({ orderId, locale: payload.locale })
          ).pipe(
            Effect.provide(reservations.paymentRetry(authorization)),
            runToCompletion,
            answerSessionApiFailure("customerApi.retryPayment"),
            Effect.flatMap(answerPaymentRetry)
          )
        )
        // Showing a code can issue it at the lock provider and store it, so
        // it ends even when the client disconnects.
        .handle("getReservationAccess", ({ params: { orderId } }) =>
          Effect.flatMap(ReservationAccessService, (access) =>
            access.getAccess({ orderId, locale: defaultLocale })
          ).pipe(
            Effect.provide(reservations.access(authorization)),
            runToCompletion,
            answerSessionApiFailure("customerApi.getReservationAccess"),
            Effect.flatMap(answerReservationAccess)
          )
        )
        .handle("getReservationInvoice", ({ params: { orderId } }) =>
          Effect.flatMap(ReservationInvoicePdfService, (invoices) =>
            invoices.getPdf({ orderId, locale: defaultLocale })
          ).pipe(
            Effect.provide(reservations.invoice(authorization)),
            Effect.catchTags(
              {
                ReservationInvoiceNotFoundError: () =>
                  Effect.fail(new CustomerReservationNotFound()),
                ReservationInvoiceNotIssuedError: () =>
                  Effect.fail(new CustomerInvoiceNotIssued()),
              },
              (failure) =>
                answerSessionApiFailure("customerApi.getReservationInvoice")(
                  Effect.fail(failure)
                )
            ),
            Effect.map(answerFileDownload("application/pdf"))
          )
        )
    );
  })
);

/**
 * The history the contract carries. Only the account page's account state
 * degrades a history to unavailable, so each reason answers as the account
 * failure it stands for.
 */
const answerReservationHistory = (history: ReservationHistoryRecord) =>
  Match.value(history).pipe(
    Match.discriminatorsExhaustive("kind")({
      available: ({ groups }) =>
        Effect.succeed<CustomerReservationHistory>({
          current: groups.current.map(answerReservationSummary),
          past: groups.past.map(answerReservationSummary),
          unavailable: groups.unavailable.map(answerReservationSummary),
        }),
      unavailable: ({ reason }) =>
        Match.value(reason).pipe(
          Match.when("provider-unavailable", () =>
            answerUnavailable("customerApi.listReservations", { reason })
          ),
          Match.when("link-required", () =>
            Effect.fail(
              new CustomerAccountLinkRequired({ reason: "profile-missing" })
            )
          ),
          Match.when("email-unverified", () =>
            Effect.fail(new CustomerSessionRequired())
          ),
          Match.exhaustive
        ),
    })
  );

/** A history entry's product, with a cowork booking's stay. */
const answerReservationProduct = (
  reservation: Pick<ReservationSummaryRecord, "endsAt" | "product" | "startsAt">
): CustomerReservationSummary["product"] => {
  const { product } = reservation;
  const stay = getReservationSummaryStay(reservation);
  return product.kind === "cowork" && stay ? { ...product, stay } : product;
};

/** A history entry as the contract carries it, without unknown fields. */
const answerReservationSummary = ({
  id,
  workspaceReservationId,
  reviewSandbox,
  party,
  product,
  startsAt,
  endsAt,
  setupStartsAt,
  seats,
  status,
  productName,
  accessStartsAt,
  accessEndsAt,
  bookedSelection,
  todayAccess,
}: ReservationSummaryRecord): CustomerReservationSummary => ({
  id,
  ...(workspaceReservationId && { orderId: workspaceReservationId }),
  ...(reviewSandbox && { reviewSandbox }),
  ...(party && { party }),
  product: answerReservationProduct({ product, startsAt, endsAt }),
  startsAt,
  endsAt,
  ...(setupStartsAt && { setupStartsAt }),
  seats,
  status,
  ...(productName !== undefined && { productName }),
  ...(accessStartsAt && accessEndsAt && { accessStartsAt, accessEndsAt }),
  ...(bookedSelection && {
    bookedSelection: answerBookedSelection(bookedSelection),
  }),
  ...(todayAccess && {
    todayAccess: {
      code: todayAccess.code,
      accessStartsAt: todayAccess.accessStartsAt,
      accessEndsAt: todayAccess.accessEndsAt,
    },
  }),
});

/** A booking selection as `createCheckout` takes it, without unknown fields. */
const answerBookedSelection = ({
  selection: {
    family,
    date,
    endDate,
    startTime,
    duration,
    seats,
    tier,
    stay,
    coffee,
    monitorOption,
  },
  earlySetup,
}: RebookingSelection): CustomerBookedSelection => ({
  selection: {
    family,
    date,
    ...(endDate !== undefined && { endDate }),
    ...(startTime !== undefined && { startTime }),
    ...(duration !== undefined && { duration }),
    ...(seats !== undefined && { seats }),
    ...(tier !== undefined && { tier }),
    ...(stay !== undefined && { stay }),
    ...(coffee !== undefined && { coffee }),
    ...(monitorOption !== undefined && { monitorOption }),
  },
  ...(earlySetup && { earlySetup }),
});

/** Where the space is, from the site's own location constants. */
const establishment: CustomerEstablishment = {
  name: workspaceSiteConstants.brand.name,
  formattedAddress: workspaceFormattedAddress,
  address: workspaceSiteConstants.location.address,
  coordinates: workspaceSiteConstants.location.coordinates,
  directionsUrl: workspaceGoogleDirectionsUrl,
  mapUrl: workspaceGoogleMapUrl,
};

/** An order the account may see, as the contract carries its status. */
const answerOrderState = (state: CheckoutStatusViewModel) =>
  Match.value(state).pipe(
    Match.when({ status: "not_found" }, () =>
      Effect.fail(new CustomerReservationNotFound())
    ),
    Match.orElse(
      ({
        orderId,
        kind,
        status,
        paymentStatus,
        fulfillmentStatus,
        reviewSandbox,
        paymentPageReopenable,
        summary,
        bookedSelection,
      }) =>
        Effect.succeed<CustomerOrderState>({
          orderId,
          kind,
          status,
          paymentStatus,
          fulfillmentStatus,
          ...(reviewSandbox && { reviewSandbox }),
          ...(paymentPageReopenable && { paymentPageReopenable }),
          ...(summary && {
            startsAt: summary.reservedFrom.toString(),
            endsAt: summary.reservedUntil.toString(),
            ...("setupFrom" in summary &&
              summary.setupFrom && {
                setupStartsAt: summary.setupFrom.toString(),
              }),
            total: {
              value: summary.price.value,
              exponent: summary.price.exponent,
              currency: summary.price.currency,
            },
          }),
          ...(bookedSelection && {
            bookedSelection: answerBookedSelection(bookedSelection),
          }),
        })
    )
  );

/** The payment page to open again, or why the order has none. */
const answerPaymentPage = (reopening: PaymentPageReopening) =>
  Match.value(reopening).pipe(
    Match.discriminatorsExhaustive("state")({
      opened: ({ providerRedirectUrl }) =>
        Effect.succeed<CustomerPaymentPage>({ url: providerRedirectUrl }),
      not_found: () => Effect.fail(new CustomerReservationNotFound()),
      closed: ({ reason }) =>
        Effect.fail(new CustomerPaymentPageClosed({ reason })),
    })
  );

/**
 * The same order's checkout to pay again with the details it keeps, or why
 * it can't be paid again in place; the app then books the selection again
 * or, while the earlier payment may still settle, checks the status later.
 */
const answerPaymentRetry = (preparation: PaymentRetryPreparation) =>
  Match.value(preparation).pipe(
    Match.discriminatorsExhaustive("state")({
      ready: ({ checkout, payState, details }) =>
        Effect.succeed({
          ...toCustomerCheckout(checkout, payState.freshPayStateToken),
          details,
        }),
      not_found: () => Effect.fail(new CustomerReservationNotFound()),
      not_retryable: ({ reason }) =>
        Effect.fail(new CustomerPaymentRetryRefused({ reason })),
      spot_unavailable: () =>
        Effect.fail(
          new CustomerPaymentRetryRefused({ reason: "spot_unavailable" })
        ),
      payment_settling: () =>
        Effect.fail(
          new CustomerPaymentRetryRefused({ reason: "payment_settling" })
        ),
    })
  );

/**
 * The door code, when the account may see it and the order has one. An
 * order whose code can't be read now, though it may have one, is
 * unavailable rather than without a code.
 */
const answerReservationAccess = (access: ReservationAccessViewModel) =>
  Match.value(access).pipe(
    Match.discriminatorsExhaustive("state")({
      available: ({ code, accessStartsAt, accessEndsAt }) =>
        Effect.succeed<CustomerReservationAccess>({
          code,
          accessStartsAt: accessStartsAt.toString(),
          accessEndsAt: accessEndsAt.toString(),
        }),
      invalid_link: () => Effect.fail(new CustomerReservationNotFound()),
      unavailable: ({ reason }) =>
        Match.value(reason).pipe(
          Match.when("reservation-state", () =>
            Effect.fail(new CustomerAccessCodeUnavailable())
          ),
          Match.when("lookup-failed", () =>
            answerUnavailable("customerApi.getReservationAccess", { reason })
          ),
          Match.exhaustive
        ),
    })
  );
