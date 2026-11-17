import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiSchema } from "effect/http-api";
import { CustomerAccountLinkRequired } from "./customer-account-api";
import {
  CustomerBookingDateOutOfRange,
  CustomerBookingSelection,
  CustomerBookingSelectionInvalid,
  CustomerOfferingUnavailable,
} from "./customer-booking-selection";
import { CustomerCheckoutSummary } from "./customer-checkout-summary";
import { CustomerLocale } from "./customer-locale";
import { customerInputParseOptions } from "./customer-profile";
import {
  CustomerServiceUnavailable,
  customerReferralCodeHeader,
} from "./customer-session";
import { ReferralCode } from "./referral-code";

// Errors

/**
 * The selection can't be held now: a space it needs was taken
 * (`availability_changed`), or another submission of the same checkout
 * holds it (`checkout_conflict`). Quote again and start a new checkout.
 */
export class CustomerSelectionUnavailable extends Schema.TaggedError<CustomerSelectionUnavailable>()(
  "CustomerSelectionUnavailable",
  { reason: Schema.Literals(["availability_changed", "checkout_conflict"]) }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/**
 * The quote's `advertisedPriceToken` expired, or doesn't match the
 * selection. Quote again.
 */
export class CustomerQuoteExpired extends Schema.TaggedError<CustomerQuoteExpired>()(
  "CustomerQuoteExpired",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/**
 * The contact or billing details aren't ones the booking form accepts.
 * `field` names the first one, such as `contact.email` or
 * `billing.address.postalCode`.
 */
export class CustomerCheckoutDetailsInvalid extends Schema.TaggedError<CustomerCheckoutDetailsInvalid>()(
  "CustomerCheckoutDetailsInvalid",
  { field: Schema.optionalKey(Schema.String) }
) {
  static schema = this.pipe(HttpApiSchema.status("BadRequest"));
}

/**
 * The signed-in customer started no checkout with this `payStateToken`.
 * The answer doesn't tell whether the order exists.
 */
export class CustomerCheckoutNotFound extends Schema.TaggedError<CustomerCheckoutNotFound>()(
  "CustomerCheckoutNotFound",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}

export const CustomerCheckoutUnavailableReason = Schema.Literals([
  "expired",
  "payment_in_progress",
  "price_review_pending",
  "not_payable",
  "reservation_ended",
  "offer_replaced",
]).annotate({
  identifier: "CustomerCheckoutUnavailableReason",
  description:
    "expired: the hold or its token ended, start a new checkout. payment_in_progress: a payment for the order has started. price_review_pending: accept the changed price first. not_payable: the order's payment is in progress or it can no longer be paid, open its status screen. reservation_ended: the booked time has passed. offer_replaced: the cowork offer booked is no longer sold.",
});
export type CustomerCheckoutUnavailableReason =
  typeof CustomerCheckoutUnavailableReason.Type;

/** The checkout can't take this step; `reason` names what to do instead. */
export class CustomerCheckoutUnavailable extends Schema.TaggedError<CustomerCheckoutUnavailable>()(
  "CustomerCheckoutUnavailable",
  { reason: CustomerCheckoutUnavailableReason }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

/**
 * The code wasn't applied; the checkout stays usable. When the server signed
 * a replacement that keeps the attempted code, `payStateToken` and
 * `expiresAt` carry it and replace the client's token.
 */
export class CustomerDiscountCodeRejected extends Schema.TaggedError<CustomerDiscountCodeRejected>()(
  "CustomerDiscountCodeRejected",
  {
    reason: Schema.Literals([
      "unavailable",
      "already_attributed",
      "ineligible",
      "code_already_applied",
    ]),
    payStateToken: Schema.optionalKey(Schema.String),
    expiresAt: Schema.optionalKey(isoInstant),
  }
) {
  static schema = this.pipe(HttpApiSchema.status("UnprocessableEntity"));
}

/**
 * The legal documents changed since the client read them: list them again
 * and ask for consent again.
 */
export class CustomerLegalDocumentsChanged extends Schema.TaggedError<CustomerLegalDocumentsChanged>()(
  "CustomerLegalDocumentsChanged",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/**
 * A consent the payment needs is missing: the terms and operating rules
 * (`legal`), or the request to start the service before the withdrawal
 * period ends (`early_performance`).
 */
export class CustomerConsentRequired extends Schema.TaggedError<CustomerConsentRequired>()(
  "CustomerConsentRequired",
  { consent: Schema.Literals(["legal", "early_performance"]) }
) {
  static schema = this.pipe(HttpApiSchema.status("UnprocessableEntity"));
}

// Checkout state

/** The summary lines and sections whose price changed since the quote. */
export const CustomerCheckoutChangedKeys = Schema.Struct({
  sectionKeys: Schema.Array(Schema.String),
  itemKeys: Schema.Array(Schema.String),
}).annotate({ identifier: "CustomerCheckoutChangedKeys" });

/**
 * A held order ready to pay, as its signed checkout state describes it.
 * `price_review`: the price changed; show `summary` and `priceReview`, and
 * call `acceptCheckoutPriceChange` before submitting.
 */
export const CustomerCheckout = Schema.Struct({
  status: Schema.Literals(["ready", "price_review"]),
  orderId: Schema.String,
  /** Sent back with every later checkout step; opaque to the client. */
  payStateToken: Schema.String,
  /**
   * When `payStateToken` stops working. Each step that returns a new token
   * gives it a new expiry; count the hold down with `holdExpiresAt`.
   */
  expiresAt: isoInstant,
  /**
   * When the hold ends and the order can no longer be paid. Applying or
   * clearing a code and accepting a price never move it.
   */
  holdExpiresAt: isoInstant,
  summary: CustomerCheckoutSummary,
  /**
   * The entered discount code the price includes. Its line is the summary
   * discount whose `discount.id` is `discountId`; remove it with
   * `clearCheckoutDiscountCode`.
   */
  appliedDiscountCode: Schema.optionalKey(
    Schema.Struct({ code: Schema.String, discountId: Schema.String })
  ),
  priceReview: Schema.optionalKey(
    Schema.Struct({ changedKeys: CustomerCheckoutChangedKeys })
  ),
  /**
   * Whether submitting needs `earlyPerformanceConsent: true`: it does when
   * the booking starts before `requiredFrom` passes the withdrawal period.
   */
  earlyPerformanceConsent: Schema.Struct({
    required: Schema.Boolean,
    requiredFrom: isoInstant,
  }),
  /** The price includes the invited customer's referral benefit. */
  referralApplied: Schema.optionalKey(Schema.Literal(true)),
  /**
   * The remembered referral code was used up: stop sending it in
   * `x-deskohub-referral-code`.
   */
  rememberedReferralCodeUsed: Schema.optionalKey(Schema.Literal(true)),
  /**
   * Remember this referral code and send it in `x-deskohub-referral-code`
   * on later bookings, as the site's referral cookie does.
   */
  rememberReferralCode: Schema.optionalKey(ReferralCode),
}).annotate({ identifier: "CustomerCheckout" });
export type CustomerCheckout = typeof CustomerCheckout.Type;

/**
 * A review account's hold: nothing is reserved and payment is switched off,
 * so there's no checkout to continue.
 */
export const CustomerCheckoutPaymentDisabled = Schema.Struct({
  status: Schema.Literal("payment_disabled"),
  orderId: Schema.String,
}).annotate({ identifier: "CustomerCheckoutPaymentDisabled" });

export const CustomerCheckoutStart = Schema.Union([
  CustomerCheckout,
  CustomerCheckoutPaymentDisabled,
]).annotate({ identifier: "CustomerCheckoutStart" });
export type CustomerCheckoutStart = typeof CustomerCheckoutStart.Type;

/**
 * The checkout after a code: `discountCode` says how it applied, and is
 * absent when the price changed first and needs review.
 */
export const CustomerCheckoutDiscountCodeResult = Schema.Struct({
  ...CustomerCheckout.fields,
  discountCode: Schema.optionalKey(
    Schema.Literals(["applied", "referral_accepted"])
  ),
}).annotate({ identifier: "CustomerCheckoutDiscountCodeResult" });
export type CustomerCheckoutDiscountCodeResult =
  typeof CustomerCheckoutDiscountCodeResult.Type;

/**
 * A submitted checkout. `payment_required`: open `paymentUrl` (the payment
 * gateway); it returns to the Workspace site, which redirects to
 * `statusUrl`: the site's status page, or the app screen the submission's
 * `returnTarget` names. `paid`: nothing is left to pay; `statusUrl` follows
 * the same choice. `price_review`: the price changed at submission.
 */
export const CustomerCheckoutSubmission = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("payment_required"),
    orderId: Schema.String,
    paymentUrl: Schema.String,
    statusUrl: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("paid"),
    orderId: Schema.String,
    statusUrl: Schema.String,
    rememberedReferralCodeUsed: Schema.optionalKey(Schema.Literal(true)),
  }),
  CustomerCheckout,
]).annotate({ identifier: "CustomerCheckoutSubmission" });
export type CustomerCheckoutSubmission = typeof CustomerCheckoutSubmission.Type;

// Requests

const RememberedReferralHeaders = Schema.Struct({
  [customerReferralCodeHeader]: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(64))
  ),
});

const contactText = (maximumLength: number) =>
  Schema.String.check(Schema.isMaxLength(maximumLength));

const CustomerInvoiceAddress = Schema.Struct({
  line1: contactText(180),
  line2: Schema.optionalKey(contactText(180)),
  city: contactText(255),
  postalCode: contactText(20),
  /** ISO 3166-1 alpha-2 country code. */
  country: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
}).annotate({ identifier: "CustomerInvoiceAddress" });

/** What the booking is for and the invoice it needs, as the booking form asks. */
export const CustomerCheckoutBilling = Schema.Union([
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("none"),
  }),
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("requested"),
    address: CustomerInvoiceAddress,
  }),
  Schema.Struct({
    purpose: Schema.Literal("business"),
    invoice: Schema.Literal("required"),
    buyer: Schema.Struct({
      kind: Schema.Literal("business"),
      legalName: contactText(180),
      companyId: contactText(64),
      vatId: Schema.optionalKey(contactText(64)),
      address: CustomerInvoiceAddress,
    }),
  }),
]).annotate({ identifier: "CustomerCheckoutBilling" });

export const CreateCustomerCheckout = Schema.Struct({
  /** The language the client shows the checkout in. */
  locale: CustomerLocale,
  /** Client-generated, stable while the customer stays on one booking. */
  checkoutSessionId: Schema.NonEmptyString,
  /** Client-generated, new for each submission of the booking. */
  checkoutAttemptId: Schema.NonEmptyString,
  /** From the quote of the same selection. */
  advertisedPriceToken: Schema.NonEmptyString,
  selection: CustomerBookingSelection,
  /** Meeting room only: the room opens early for setup, at no cost. */
  earlySetup: Schema.optionalKey(Schema.Boolean),
  /**
   * `self`: the account's own profile is the contact and Dotypos customer;
   * `contact` only completes a profile not yet linked. `someone-else`:
   * `contact` books.
   */
  bookingFor: Schema.Literals(["self", "someone-else"]),
  contact: Schema.Struct({
    name: contactText(255),
    email: contactText(255),
    phone: contactText(32),
  }),
  billing: CustomerCheckoutBilling,
  /** True only when the customer opted in; absent or false records nothing. */
  marketingConsent: Schema.optionalKey(Schema.Boolean),
}).annotate({
  identifier: "CreateCustomerCheckout",
});
export type CreateCustomerCheckout = typeof CreateCustomerCheckout.Type;

const PayStateStep = {
  locale: CustomerLocale,
  payStateToken: Schema.NonEmptyString,
};

export const ApplyCustomerCheckoutDiscountCode = Schema.Struct({
  ...PayStateStep,
  code: Schema.String.check(Schema.isMaxLength(64)),
}).annotate({
  identifier: "ApplyCustomerCheckoutDiscountCode",
});

export const ClearCustomerCheckoutDiscountCode = Schema.Struct(
  PayStateStep
).annotate({
  identifier: "ClearCustomerCheckoutDiscountCode",
});

export const AcceptCustomerCheckoutPriceChange = Schema.Struct(
  PayStateStep
).annotate({
  identifier: "AcceptCustomerCheckoutPriceChange",
});

/**
 * The app a payment returns the customer to. `native-app`:
 * `deskohub://reservations/{orderId}?after=payment`, which ends the app's
 * payment browser session. `web-app`:
 * `/app/reservations/{orderId}?after=payment` on the Workspace origin.
 */
export const CustomerCheckoutReturnTarget = Schema.Literals([
  "native-app",
  "web-app",
]).annotate({ identifier: "CustomerCheckoutReturnTarget" });
export type CustomerCheckoutReturnTarget =
  typeof CustomerCheckoutReturnTarget.Type;

export const SubmitCustomerCheckout = Schema.Struct({
  ...PayStateStep,
  /** The customer accepted the terms and operating rules. */
  legalConsent: Schema.Boolean,
  /** Required when the checkout's `earlyPerformanceConsent.required`. */
  earlyPerformanceConsent: Schema.optionalKey(Schema.Boolean),
  /** The documents the customer accepted, as `listLegalDocuments` gave them. */
  acceptedLegalDocuments: Schema.Array(
    Schema.Struct({ key: Schema.String, hash: Schema.String })
  ),
  /** Absent: the payment returns to the Workspace site's status page. */
  returnTarget: Schema.optionalKey(CustomerCheckoutReturnTarget),
}).annotate({
  identifier: "SubmitCustomerCheckout",
});

// Endpoints

const checkoutStepErrors = [
  CustomerCheckoutNotFound.schema,
  CustomerCheckoutUnavailable.schema,
  CustomerServiceUnavailable.schema,
] as const;

/**
 * Holds a quoted selection for the signed-in customer and returns its
 * checkout. A booking spends two to four Dotypos mutations: this, an
 * optional code, the submission, and one retry after a price change.
 */
const createCheckout = HttpApiEndpoint.post("createCheckout", "/checkouts", {
  headers: RememberedReferralHeaders,
  payload: CreateCustomerCheckout,
  success: CustomerCheckoutStart,
  error: [
    CustomerBookingSelectionInvalid.schema,
    CustomerBookingDateOutOfRange.schema,
    CustomerOfferingUnavailable.schema,
    CustomerCheckoutDetailsInvalid.schema,
    CustomerSelectionUnavailable.schema,
    CustomerQuoteExpired.schema,
    CustomerAccountLinkRequired.schema,
    CustomerServiceUnavailable.schema,
  ],
}).annotate(HttpApi.PayloadParseOptions, customerInputParseOptions);

/** Applies a discount or referral code to a held checkout. */
const applyCheckoutDiscountCode = HttpApiEndpoint.post(
  "applyCheckoutDiscountCode",
  "/checkouts/discount-code",
  {
    headers: RememberedReferralHeaders,
    payload: ApplyCustomerCheckoutDiscountCode,
    success: CustomerCheckoutDiscountCodeResult,
    error: [CustomerDiscountCodeRejected.schema, ...checkoutStepErrors],
  }
).annotate(HttpApi.PayloadParseOptions, customerInputParseOptions);

/**
 * Removes the entered discount code from a held checkout. When the code was
 * in the price, the checkout comes back as `price_review` without it: accept
 * it before submitting. With no code entered, it returns the checkout as it
 * is, so a retry is safe. It doesn't extend the hold.
 */
const clearCheckoutDiscountCode = HttpApiEndpoint.post(
  "clearCheckoutDiscountCode",
  "/checkouts/discount-code/clear",
  {
    payload: ClearCustomerCheckoutDiscountCode,
    success: CustomerCheckout,
    error: [...checkoutStepErrors],
  }
).annotate(HttpApi.PayloadParseOptions, customerInputParseOptions);

/**
 * Accepts the changed price a `price_review` checkout shows. It doesn't
 * extend the hold.
 */
const acceptCheckoutPriceChange = HttpApiEndpoint.post(
  "acceptCheckoutPriceChange",
  "/checkouts/price-acceptance",
  {
    payload: AcceptCustomerCheckoutPriceChange,
    success: CustomerCheckout,
    error: [...checkoutStepErrors],
  }
).annotate(HttpApi.PayloadParseOptions, customerInputParseOptions);

/**
 * Submits a checkout for payment, after checking its consents and the
 * current price.
 */
const submitCheckout = HttpApiEndpoint.post(
  "submitCheckout",
  "/checkouts/submit",
  {
    headers: RememberedReferralHeaders,
    payload: SubmitCustomerCheckout,
    success: CustomerCheckoutSubmission,
    error: [
      CustomerConsentRequired.schema,
      CustomerLegalDocumentsChanged.schema,
      CustomerSelectionUnavailable.schema,
      ...checkoutStepErrors,
    ],
  }
).annotate(HttpApi.PayloadParseOptions, customerInputParseOptions);

/** The booking group's checkout endpoints, in the order a booking calls them. */
export const customerBookingCheckoutEndpoints = [
  createCheckout,
  applyCheckoutDiscountCode,
  clearCheckoutDiscountCode,
  acceptCheckoutPriceChange,
  submitCheckout,
] as const;
