import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { CustomerAccountLinkRequired, Money } from "./customer-account-api";
import {
  CustomerCheckout,
  CustomerCheckoutReturnTarget,
} from "./customer-booking-checkout-api";
import {
  CustomerBookingSelection,
  CustomerCoworkStay,
} from "./customer-booking-selection";
import { CustomerLocale } from "./customer-locale";
import { customerInputParseOptions } from "./customer-profile";
import { CustomerServiceUnavailable } from "./customer-session";
import { responseHeaders } from "./openapi-response-headers";

// Errors

/**
 * No order with this ID that the signed-in account may see: it doesn't
 * exist, or it belongs to someone else.
 */
export class CustomerReservationNotFound extends Schema.TaggedError<CustomerReservationNotFound>()(
  "CustomerReservationNotFound",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}

/**
 * The order has no door code to show: it isn't paid and confirmed yet, or
 * it has ended. Asking again later can succeed only once its status changes.
 */
export class CustomerAccessCodeUnavailable extends Schema.TaggedError<CustomerAccessCodeUnavailable>()(
  "CustomerAccessCodeUnavailable",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/**
 * The order has no issued invoice: it isn't paid and confirmed yet, or it
 * needs none. Asking again can succeed only once its status changes.
 */
export class CustomerInvoiceNotIssued extends Schema.TaggedError<CustomerInvoiceNotIssued>()(
  "CustomerInvoiceNotIssued",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/**
 * Why the order has no payment page to open again: it is `paid`, a
 * `late_payment` of it is being checked, its hold was `released`, it has
 * `no_active_attempt` whose page is still open (it ended or never opened
 * one), or the page's `window_elapsed`. The order's status shows what to do
 * next.
 */
export const CustomerPaymentPageClosedReason = Schema.Literals([
  "paid",
  "late_payment",
  "released",
  "no_active_attempt",
  "window_elapsed",
]).annotate({ identifier: "CustomerPaymentPageClosedReason" });
export type CustomerPaymentPageClosedReason =
  typeof CustomerPaymentPageClosedReason.Type;

/**
 * The order's payment page can't be opened again, for `reason`. Asking again
 * can succeed only once a new payment opens a page.
 */
export class CustomerPaymentPageClosed extends Schema.TaggedError<CustomerPaymentPageClosed>()(
  "CustomerPaymentPageClosed",
  { reason: CustomerPaymentPageClosedReason }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/**
 * Why the order's payment can't be tried again in place. The order is
 * `paid`; its `payment_in_progress` may still complete; a `late_payment` of
 * it is being checked; a newer booking `superseded` it; its reservation was
 * cancelled (`reservation_cancelled`) or has ended (`reservation_ended`);
 * its details can't be rebuilt (`details_unavailable`) or need a person to
 * look at them (`needs_review`); the reserved spot was taken meanwhile
 * (`spot_unavailable`); or the provider shows the earlier payment may still
 * settle (`payment_settling`: check the order's status again later, don't
 * book again). For every reason but `payment_settling`, booking the same
 * selection again is the way on.
 */
export const CustomerPaymentRetryRefusedReason = Schema.Literals([
  "paid",
  "payment_in_progress",
  "late_payment",
  "superseded",
  "reservation_cancelled",
  "reservation_ended",
  "details_unavailable",
  "needs_review",
  "spot_unavailable",
  "payment_settling",
]).annotate({ identifier: "CustomerPaymentRetryRefusedReason" });
export type CustomerPaymentRetryRefusedReason =
  typeof CustomerPaymentRetryRefusedReason.Type;

/** The order's payment can't be tried again in place, for `reason`. */
export class CustomerPaymentRetryRefused extends Schema.TaggedError<CustomerPaymentRetryRefused>()(
  "CustomerPaymentRetryRefused",
  { reason: CustomerPaymentRetryRefusedReason }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

// Reservations

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

/** An order the website booked: the ID its status and door code go by. */
export const CustomerReservationOrderId = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceReservationId")
).annotate({
  identifier: "CustomerReservationOrderId",
  description: "Opaque identifier of an order booked on the website.",
});
export type CustomerReservationOrderId = typeof CustomerReservationOrderId.Type;

/** The kinds of space an order books. */
export const CustomerReservationKind = Schema.Literals([
  "cowork",
  "meeting-room",
  "office",
]).annotate({ identifier: "CustomerReservationKind" });
export type CustomerReservationKind = typeof CustomerReservationKind.Type;

/** The cowork tiers a reservation can have, current and historical. */
export const CustomerCoworkTier = Schema.Literals([
  "basic",
  "plus",
  "profi",
  "open-space",
  "reserved-desk",
]).annotate({ identifier: "CustomerCoworkTier" });
export type CustomerCoworkTier = typeof CustomerCoworkTier.Type;

/** What a reservation in the history books; `other` for any other product. */
export const CustomerReservationProduct = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("cowork"),
    tier: CustomerCoworkTier,
    /**
     * The stay its booked time shows: overnight for a Reserved Desk held from
     * noon to noon the next date. Absent when its time can't be read; read an
     * absent stay as a day.
     */
    stay: Schema.optionalKey(CustomerCoworkStay),
  }),
  Schema.Struct({ kind: Schema.Literal("meeting-room") }),
  Schema.Struct({ kind: Schema.Literal("office") }),
  Schema.Struct({ kind: Schema.Literal("other") }),
]).annotate({ identifier: "CustomerReservationProduct" });
export type CustomerReservationProduct = typeof CustomerReservationProduct.Type;

/**
 * The other party of a reservation in the history: the customer the account
 * booked it for, or the account that booked it for the account's own
 * customer. A name that couldn't be read is null; a deleted author is never
 * named.
 */
export const CustomerReservationParty = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("booked-for"),
    customerName: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("booked-by"),
    authorName: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("booked-by-deleted-account") }),
]).annotate({ identifier: "CustomerReservationParty" });
export type CustomerReservationParty = typeof CustomerReservationParty.Type;

export const CustomerReservationStatus = Schema.Literals([
  "cancelled",
  "confirmed",
  "pending",
  "requires-attention",
]).annotate({ identifier: "CustomerReservationStatus" });
export type CustomerReservationStatus = typeof CustomerReservationStatus.Type;

/**
 * The door code of a paid, confirmed order, and when the lock accepts it.
 */
export const CustomerReservationAccess = Schema.Struct({
  code: Schema.NonEmptyString,
  accessStartsAt: isoInstant,
  accessEndsAt: isoInstant,
}).annotate({ identifier: "CustomerReservationAccess" });
export type CustomerReservationAccess = typeof CustomerReservationAccess.Type;

/**
 * What booking a reservation again sends to `createCheckout`: its selection,
 * and `earlySetup` beside it for a meeting room booked with early setup.
 */
export const CustomerBookedSelection = Schema.Struct({
  selection: CustomerBookingSelection,
  earlySetup: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "CustomerBookedSelection" });
export type CustomerBookedSelection = typeof CustomerBookedSelection.Type;

/** A reservation as the account page's history lists it. */
export const CustomerReservationSummary = Schema.Struct({
  /** Unique within the history; only for telling entries apart. */
  id: Schema.String,
  /** Absent for a reservation not booked on the website. */
  orderId: Schema.optional(CustomerReservationOrderId),
  /**
   * Marks a review account's sample or simulated hold: it has a status but
   * never a door code.
   */
  reviewSandbox: Schema.optional(Schema.Literal(true)),
  /** Absent when the account's own customer booked it for itself. */
  party: Schema.optional(CustomerReservationParty),
  product: CustomerReservationProduct,
  /** Null when the provider's time can't be read. */
  startsAt: Schema.NullOr(isoInstant),
  endsAt: Schema.NullOr(isoInstant),
  /**
   * When the customer of a meeting room booked with early setup may arrive,
   * before `startsAt`.
   */
  setupStartsAt: Schema.optional(isoInstant),
  /** Null when the provider's seat count can't be read. */
  seats: Schema.NullOr(Schema.Int),
  status: CustomerReservationStatus,
  /**
   * The catalog name of `product` in the request's locale, as the website
   * names it.
   */
  productName: Schema.optional(Schema.String),
  /**
   * When the order's door code works: the span the reservation system holds,
   * early setup included. Absent for a reservation not booked on the website
   * or whose time can't be read.
   */
  accessStartsAt: Schema.optional(isoInstant),
  accessEndsAt: Schema.optional(isoInstant),
  /**
   * What booking it again sends, so a client can preselect it. Absent when
   * its product can no longer be booked, such as a retired cowork tier.
   */
  bookedSelection: Schema.optional(CustomerBookedSelection),
  /**
   * The door code of a confirmed booking whose access starts by today in
   * Prague and hasn't ended. Absent otherwise, for a review account, or
   * while the code can't be shown now: the order's access endpoint then
   * answers why.
   */
  todayAccess: Schema.optional(CustomerReservationAccess),
}).annotate({ identifier: "CustomerReservationSummary" });
export type CustomerReservationSummary = typeof CustomerReservationSummary.Type;

/**
 * The signed-in account's reservations, grouped as the account page groups
 * them: current until their end, past once ended or cancelled, and
 * `unavailable` when their time can't be read.
 */
export const CustomerReservationHistory = Schema.Struct({
  current: Schema.Array(CustomerReservationSummary),
  past: Schema.Array(CustomerReservationSummary),
  unavailable: Schema.Array(CustomerReservationSummary),
}).annotate({ identifier: "CustomerReservationHistory" });
export type CustomerReservationHistory = typeof CustomerReservationHistory.Type;

/**
 * Where an order is between checkout and the booked reservation. `created`:
 * held, not paid yet; `pending`: payment in progress; `paid_*`: paid and
 * being confirmed; `fulfilled`: confirmed; `payment_failed`, `cancelled`,
 * `expired`: not booked; `late_payment_*`: a payment after the hold expired
 * is being checked or refunded. `*_delayed` asks the customer to wait longer
 * than usual.
 */
export const CustomerOrderStatus = Schema.Literals([
  "created",
  "pending",
  "payment_pending_delayed",
  "paid_waiting_fulfillment",
  "paid_fulfillment_delayed",
  "paid_awaiting_delivery",
  "paid_delivery_delayed",
  "fulfilled",
  "fulfillment_failed",
  "payment_failed",
  "cancelled",
  "expired",
  "late_payment_checking",
  "late_payment_refund",
  "late_payment_review",
]).annotate({ identifier: "CustomerOrderStatus" });
export type CustomerOrderStatus = typeof CustomerOrderStatus.Type;

export const CustomerOrderPaymentStatus = Schema.Literals([
  "not_started",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
]).annotate({ identifier: "CustomerOrderPaymentStatus" });
export type CustomerOrderPaymentStatus = typeof CustomerOrderPaymentStatus.Type;

export const CustomerOrderFulfillmentStatus = Schema.Literals([
  "not_started",
  "processing",
  "awaiting_delivery",
  "fulfilled",
  "failed",
]).annotate({ identifier: "CustomerOrderFulfillmentStatus" });
export type CustomerOrderFulfillmentStatus =
  typeof CustomerOrderFulfillmentStatus.Type;

/**
 * An order's status as its status page shows it, after the page's refresh
 * with the payment provider. The time and total are absent while the order
 * doesn't have them.
 */
export const CustomerOrderState = Schema.Struct({
  orderId: CustomerReservationOrderId,
  kind: CustomerReservationKind,
  status: CustomerOrderStatus,
  paymentStatus: CustomerOrderPaymentStatus,
  fulfillmentStatus: CustomerOrderFulfillmentStatus,
  /** With status `cancelled`, marks a cancelled reservation irrespective of the payment outcome. */
  reservationCancelled: Schema.optional(Schema.Literal(true)),
  /** Marks a review account's sample or simulated hold. */
  reviewSandbox: Schema.optional(Schema.Literal(true)),
  /**
   * Marks a pending order whose payment page can be opened again
   * (`reopenPaymentPage`): the payment provider's order still shows no
   * activity, or, when it can't be asked, the page is inside its provisional
   * reopening window. The answer can change at any moment; reopening checks
   * again.
   */
  paymentPageReopenable: Schema.optional(Schema.Literal(true)),
  startsAt: Schema.optional(isoInstant),
  endsAt: Schema.optional(isoInstant),
  /**
   * When the customer of a meeting room booked with early setup may arrive,
   * before `startsAt`.
   */
  setupStartsAt: Schema.optional(isoInstant),
  total: Schema.optional(Money),
  /**
   * What booking the order again sends, while its time and total are known
   * and its product can still be booked.
   */
  bookedSelection: Schema.optional(CustomerBookedSelection),
}).annotate({ identifier: "CustomerOrderState" });
export type CustomerOrderState = typeof CustomerOrderState.Type;

/**
 * An order's issued invoice as a PDF document, served as an attachment
 * named by the invoice number.
 */
export const CustomerInvoicePdf = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/pdf" })
).annotate({
  identifier: "CustomerInvoicePdf",
  description: "The issued invoice as a PDF document.",
});

/** Where the booked space is: its address, position, and map links. */
export const CustomerEstablishment = Schema.Struct({
  name: Schema.String,
  /** The whole address on one line. */
  formattedAddress: Schema.String,
  address: Schema.Struct({
    street: Schema.String,
    cityDistrict: Schema.String,
    city: Schema.String,
    postalCode: Schema.String,
    /** ISO 3166-1 alpha-2 country code. */
    country: Schema.String,
  }),
  coordinates: Schema.Struct({ lat: Schema.Number, lng: Schema.Number }),
  /** Google Maps directions to the space. */
  directionsUrl: Schema.String,
  /** Google Maps centred on the space. */
  mapUrl: Schema.String,
}).annotate({ identifier: "CustomerEstablishment" });
export type CustomerEstablishment = typeof CustomerEstablishment.Type;

// Endpoints

const OrderParams = { orderId: CustomerReservationOrderId } as const;

/**
 * Where the reopened page's payment returns the customer. Like a checkout
 * submission, the last request that hands out the order's payment page
 * decides.
 */
export const ReopenCustomerPaymentPage = Schema.Struct({
  /** Absent: the payment returns to the Workspace site's status page. */
  returnTarget: Schema.optionalKey(CustomerCheckoutReturnTarget),
}).annotate({
  identifier: "ReopenCustomerPaymentPage",
});

/**
 * Pays an order again after its payment failed, was cancelled or expired:
 * the checkout continues in `locale`, the language the app shows it in.
 */
export const RetryCustomerPayment = Schema.Struct({
  locale: CustomerLocale,
}).annotate({
  identifier: "RetryCustomerPayment",
});

/**
 * What the order is for and the invoice it needs, as the review shows it:
 * the city of a personal invoice, or the name of the company a business
 * invoice is for.
 */
export const CustomerPaymentRetryBilling = Schema.Union([
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("none"),
  }),
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("requested"),
    city: Schema.String,
  }),
  Schema.Struct({
    purpose: Schema.Literal("business"),
    invoice: Schema.Literal("required"),
    legalName: Schema.String,
  }),
]).annotate({ identifier: "CustomerPaymentRetryBilling" });
export type CustomerPaymentRetryBilling =
  typeof CustomerPaymentRetryBilling.Type;

/**
 * Who the order is for and the invoice it needs, kept as it was booked, for
 * the review to show. `self`: the account's own profile is the contact;
 * `someone-else`: `contact` is the customer the account booked for.
 */
export const CustomerPaymentRetryDetails = Schema.Struct({
  bookingFor: Schema.Literals(["self", "someone-else"]),
  contact: Schema.Struct({ name: Schema.String, email: Schema.String }),
  billing: CustomerPaymentRetryBilling,
}).annotate({ identifier: "CustomerPaymentRetryDetails" });
export type CustomerPaymentRetryDetails =
  typeof CustomerPaymentRetryDetails.Type;

/**
 * The order's checkout to pay again, with the details it keeps. They can't
 * be changed here: booking again is the way to change them.
 */
export const CustomerPaymentRetry = Schema.Struct({
  ...CustomerCheckout.fields,
  details: CustomerPaymentRetryDetails,
}).annotate({ identifier: "CustomerPaymentRetry" });
export type CustomerPaymentRetry = typeof CustomerPaymentRetry.Type;

/**
 * The payment provider's page of the order's unpaid payment, opened again
 * for a customer who left it. It is the page the payment already opened:
 * opening it starts no new payment.
 */
export const CustomerPaymentPage = Schema.Struct({
  url: Schema.NonEmptyString.annotate({
    description: "The payment provider's page to open in a browser.",
  }),
}).annotate({ identifier: "CustomerPaymentPage" });
export type CustomerPaymentPage = typeof CustomerPaymentPage.Type;

/**
 * The signed-in customer's reservations: the history, where the space is,
 * the status, door code and invoice of an order the account booked or whose
 * customer it is, and the payment page of one it hasn't paid yet.
 * The status and door code reads refresh the order, as the website's pages
 * do, and the door code and invoice only the order's customer sees.
 */
export const CustomerReservationsApi = HttpApiGroup.make("reservations")
  .add(
    HttpApiEndpoint.get("listReservations", "/", {
      /** The language of `productName`; the default locale when absent. */
      query: Schema.Struct({ locale: Schema.optionalKey(CustomerLocale) }),
      success: CustomerReservationHistory,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getEstablishment", "/establishment", {
      success: CustomerEstablishment,
    })
  )
  .add(
    HttpApiEndpoint.get("getReservationStatus", "/:orderId/status", {
      params: OrderParams,
      success: CustomerOrderState,
      error: [
        CustomerReservationNotFound.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.post("reopenPaymentPage", "/:orderId/payment-page", {
      params: OrderParams,
      payload: ReopenCustomerPaymentPage,
      success: CustomerPaymentPage,
      error: [
        CustomerReservationNotFound.schema,
        CustomerPaymentPageClosed.schema,
        CustomerServiceUnavailable.schema,
      ],
    }).annotate(HttpApi.PayloadParseOptions, customerInputParseOptions)
  )
  .add(
    /**
     * The same order's checkout again, with its details kept and returned
     * in `details`: the terms are confirmed again and `submitCheckout`
     * starts the new payment. A changed price comes back as `price_review`
     * to accept first. It never starts a payment and never books a second
     * spot.
     */
    HttpApiEndpoint.post("retryPayment", "/:orderId/payment-retry", {
      params: OrderParams,
      payload: RetryCustomerPayment,
      success: CustomerPaymentRetry,
      error: [
        CustomerReservationNotFound.schema,
        CustomerPaymentRetryRefused.schema,
        CustomerServiceUnavailable.schema,
      ],
    }).annotate(HttpApi.PayloadParseOptions, customerInputParseOptions)
  )
  .add(
    HttpApiEndpoint.get("getReservationAccess", "/:orderId/access", {
      params: OrderParams,
      success: CustomerReservationAccess,
      error: [
        CustomerReservationNotFound.schema,
        CustomerAccessCodeUnavailable.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getReservationInvoice", "/:orderId/invoice", {
      params: OrderParams,
      success: CustomerInvoicePdf,
      error: [
        CustomerReservationNotFound.schema,
        CustomerInvoiceNotIssued.schema,
        CustomerServiceUnavailable.schema,
      ],
    }).annotateMerge(
      responseHeaders(200, {
        "Content-Disposition": {
          description:
            'Serves the PDF as an attachment named by the invoice number, as `attachment; filename="<invoice number>.pdf"`.',
        },
      })
    )
  )
  .prefix("/reservations");
