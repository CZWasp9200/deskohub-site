import type {
  CustomerLegalDocument,
  CustomerPaymentRetryBilling,
  Money,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { canClearCode, canPay } from "../checkout/checkout-machine";
import {
  type CheckoutDetails,
  type CodeStatus,
  ReviewKind,
  type ReviewMutation,
  type ReviewState,
} from "../checkout/checkout-state";
import { type PriceBreakdown, priceBreakdown } from "../ui/price-breakdown";
import { bookingOverviewOf } from "./booking-overview";

/**
 * Who the booking is for and who is invoiced, as the details step sent
 * them or the server kept them for an order paid again. `bookerName` is the
 * account's own name, for "Booked by" when the booking is for someone else;
 * none while the account isn't read.
 */
export type ReviewParty =
  | { readonly _tag: "Self"; readonly name: string }
  | {
      readonly _tag: "SomeoneElse";
      readonly name: string;
      readonly email: string;
      readonly bookerName: Option.Option<string>;
    };

/** Who the invoice goes to: no invoice, the customer (by city), a company. */
export type ReviewInvoice =
  | { readonly _tag: "None" }
  | { readonly _tag: "Personal"; readonly city: string }
  | { readonly _tag: "Company"; readonly legalName: string };

/** Who books, as a new booking's details or a retried order's carry it. */
interface BookedParty {
  readonly bookingFor: CheckoutDetails["bookingFor"];
  readonly contact: Pick<CheckoutDetails["contact"], "name" | "email">;
}

export const reviewParty = (
  details: BookedParty,
  bookerName: Option.Option<string>
): ReviewParty =>
  details.bookingFor === "self"
    ? { _tag: "Self", name: details.contact.name }
    : {
        _tag: "SomeoneElse",
        name: details.contact.name,
        email: details.contact.email,
        bookerName,
      };

/**
 * A new booking's billing as the review shows it: the invoice's city or the
 * company's name, the shape a retried order's kept billing already has.
 */
export const reviewBilling = (
  billing: CheckoutDetails["billing"]
): CustomerPaymentRetryBilling => {
  if (billing.purpose === "business") {
    return {
      purpose: "business",
      invoice: "required",
      legalName: billing.buyer.legalName,
    };
  }
  return billing.invoice === "requested"
    ? { purpose: "personal", invoice: "requested", city: billing.address.city }
    : { purpose: "personal", invoice: "none" };
};

export const reviewInvoice = (
  billing: CustomerPaymentRetryBilling
): ReviewInvoice => {
  if (billing.purpose === "business") {
    return { _tag: "Company", legalName: billing.legalName };
  }
  return billing.invoice === "requested"
    ? { _tag: "Personal", city: billing.city }
    : { _tag: "None" };
};

/**
 * Why the code wasn't applied, shown at the field:
 * - `AwaitingPriceAcceptance`: the price changed first; accept it, then
 *   apply the code again.
 * - `Retryable`: the code couldn't be checked (`unavailable`, R5); it isn't
 *   marked invalid.
 * - `Rejected`: the server's reason.
 */
export type CodeProblem =
  | { readonly _tag: "AwaitingPriceAcceptance" }
  | { readonly _tag: "Retryable" }
  | {
      readonly _tag: "Rejected";
      readonly reason:
        | "already_attributed"
        | "ineligible"
        | "code_already_applied";
    };

const codeProblem = (status: CodeStatus): Option.Option<CodeProblem> => {
  switch (status._tag) {
    case "Idle":
    case "Applying":
    case "Applied":
      return Option.none();
    case "AwaitingPriceAcceptance":
      return Option.some({ _tag: "AwaitingPriceAcceptance" });
    case "Rejected":
      return Option.some(
        status.reason === "unavailable"
          ? { _tag: "Retryable" }
          : { _tag: "Rejected", reason: status.reason }
      );
  }
};

/**
 * The code row:
 * - `Entry`: the field with Apply beside it. `startsOpen` while it holds
 *   something to show (an input, a running apply, a problem); otherwise
 *   the screen shows the quiet "add a code" row that opens it.
 * - `Applied`: the code the price includes, as a chip; Remove only when
 *   `canClear` (the server's applied entered code, with no price review or
 *   write running). Its saving is its own line in the price.
 */
export type CodeFieldView =
  | {
      readonly _tag: "Entry";
      readonly input: string;
      /** Holds still while any write runs. */
      readonly editable: boolean;
      readonly canApply: boolean;
      readonly applying: boolean;
      readonly problem: Option.Option<CodeProblem>;
      readonly startsOpen: boolean;
    }
  | {
      readonly _tag: "Applied";
      readonly code: string;
      readonly canClear: boolean;
      /** The code's removal runs. */
      readonly clearing: boolean;
    };

const codeFieldView = (review: ReviewState, idle: boolean): CodeFieldView => {
  const { code, checkout } = review;
  const applied = Option.orElse(
    Option.map(checkout.appliedDiscountCode, ({ code }) => code),
    () =>
      code.status._tag === "Applied" && code.input.trim() !== ""
        ? Option.some(code.input.trim())
        : Option.none()
  );
  if (Option.isSome(applied)) {
    return {
      _tag: "Applied",
      code: applied.value,
      canClear: canClearCode(review),
      clearing: pendingIs(review)("ClearDiscountCode"),
    };
  }
  const problem = codeProblem(code.status);
  const applying = code.status._tag === "Applying";
  return {
    _tag: "Entry",
    input: code.input,
    editable: idle,
    canApply: idle && code.input.trim() !== "",
    applying,
    problem,
    startsOpen: code.input !== "" || applying || Option.isSome(problem),
  };
};

/**
 * The price the server holds: its lines and total, the total struck by
 * the quote's when the two differ (a code or a changed price moved it).
 */
export interface ReviewPriceView {
  readonly breakdown: PriceBreakdown;
  readonly was: Option.Option<Money>;
}

/**
 * A changed price waiting for the customer: the total they last saw (the
 * quote's, when the review opened on the change) and the new one.
 */
export interface PriceChangeView {
  readonly before: Money;
  readonly now: Money;
  readonly accepting: boolean;
}

const sameMoney = (a: Money, b: Money) =>
  a.value === b.value && a.currency === b.currency;

export type LegalView =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failed" }
  | {
      readonly _tag: "Loaded";
      readonly documents: ReadonlyArray<CustomerLegalDocument>;
    };

export interface ConsentView {
  readonly legal: LegalView;
  readonly checked: boolean;
  readonly disabled: boolean;
  /** The checkbox also requests starting before the withdrawal period ends. */
  readonly earlyPerformance: boolean;
  /** The terms are confirmed again, for a retried payment. */
  readonly retry: boolean;
}

/**
 * Why Pay is off, also while a write runs: a changed price to accept
 * first, else the agreement to tick.
 */
export type PayBlock = "AcceptPrice" | "Agreement";

const payBlock = (
  priceChanged: boolean,
  consented: boolean
): Option.Option<PayBlock> => {
  if (priceChanged) return Option.some("AcceptPrice");
  return consented ? Option.none() : Option.some("Agreement");
};

export interface ReviewView {
  /**
   * An order paid again in place: its details are the server's, kept as
   * booked, so nothing here changes them (no Change, no code entry), and the
   * terms are confirmed again.
   */
  readonly retry: boolean;
  /** For whom. */
  readonly party: ReviewParty;
  /** A meeting room booked with early setup: the room opens before the start. */
  readonly earlySetup: boolean;
  /** Who is invoiced. */
  readonly invoice: ReviewInvoice;
  readonly price: ReviewPriceView;
  readonly priceChange: Option.Option<PriceChangeView>;
  readonly code: CodeFieldView;
  readonly consent: ConsentView;
  readonly canPay: boolean;
  readonly payBlock: Option.Option<PayBlock>;
  /** A write runs: every other review action holds still. */
  readonly busy: boolean;
  readonly submitting: boolean;
  /**
   * When the hold ends (ISO instant), from the server's latest answer, for
   * the app bar's hold timer chip. Only an answer that moves it moves the
   * chip; entering or clearing a code keeps it.
   */
  readonly holdExpiresAt: string;
}

const withEarlySetup = ({ flow }: ReviewState): boolean => {
  const overview = bookingOverviewOf(flow.selection, flow.earlySetup === true);
  return overview._tag === "MeetingRoom" && overview.earlySetup;
};

const pendingIs = (review: ReviewState) => (tag: ReviewMutation["_tag"]) =>
  Option.exists(review.pending, (pending) => pending._tag === tag);

/**
 * The review screen's view of `review`. `quotedTotal` is the total the
 * selection screen quoted; `bookerName` the account's own name.
 */
export const reviewView = (
  review: ReviewState,
  quotedTotal: Money,
  bookerName: Option.Option<string>
): ReviewView => {
  const idle = Option.isNone(review.pending);
  const pending = pendingIs(review);
  const { checkout, legal } = review;
  const total = checkout.summary.total;
  const priceChange = Option.map(
    checkout.priceReview,
    (): PriceChangeView => ({
      before: Option.getOrElse(review.priceBefore, () => quotedTotal),
      now: total,
      accepting: pending("AcceptPriceChange"),
    })
  );
  const consented = Option.isSome(review.consent);
  const { details } = review.kind;
  const retry = review.kind._tag === "PaymentRetry";
  return {
    retry,
    party: reviewParty(details, bookerName),
    earlySetup: withEarlySetup(review),
    invoice: reviewInvoice(
      ReviewKind.$match(review.kind, {
        NewBooking: ({ details }) => reviewBilling(details.billing),
        PaymentRetry: ({ details }) => details.billing,
      })
    ),
    price: {
      breakdown: priceBreakdown(checkout.summary),
      was: sameMoney(quotedTotal, total)
        ? Option.none()
        : Option.some(quotedTotal),
    },
    priceChange,
    code: codeFieldView(review, idle),
    consent: {
      legal,
      checked: consented,
      disabled: !idle || legal._tag !== "Loaded",
      earlyPerformance: checkout.earlyPerformanceConsent.required,
      retry,
    },
    canPay: canPay(review),
    payBlock: payBlock(Option.isSome(priceChange), consented),
    busy: !idle,
    submitting: pending("SubmitCheckout"),
    holdExpiresAt: checkout.holdExpiresAt,
  };
};
