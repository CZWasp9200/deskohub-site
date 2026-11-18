import type {
  AcceptCustomerCheckoutPriceChange,
  ApplyCustomerCheckoutDiscountCode,
  ClearCustomerCheckoutDiscountCode,
  CreateCustomerCheckout,
  CustomerBookingSelection,
  CustomerCheckout,
  CustomerCheckoutDiscountCodeResult,
  CustomerCheckoutStart,
  CustomerCheckoutSubmission,
  CustomerDiscountCodeRejected,
  CustomerLegalDocument,
  CustomerLocale,
  CustomerPaymentRetryDetails,
  ReferralCode,
  SubmitCustomerCheckout,
} from "@deskohub/workspace-customer-api";
import { Data, type Option } from "effect";
import type { PaymentBrowserResult } from "../payment-browser.service";
import type { RememberedReferralUpdate } from "../remembered-referral";
import type {
  BookingProblem,
  CheckoutBlockedReason,
  CheckoutRestartReason,
  CheckoutRetryKind,
} from "./booking-problem";

/**
 * Numbers each command a checkout sends, so `step` can drop the answer to
 * one it no longer waits for.
 */
export type CheckoutOperationId = number;

/** What the family screen hands the checkout. */
export interface CheckoutStartInput {
  /** Stable while the customer stays on this booking. */
  readonly checkoutSessionId: string;
  readonly locale: CustomerLocale;
  readonly selection: CustomerBookingSelection;
  /** Empty for a payment retry, which reviews an existing order and never creates one. */
  readonly advertisedPriceToken: string;
  /** Meeting room only. */
  readonly earlySetup?: boolean;
  /** The referral code the app remembers for the signed-in account. */
  readonly rememberedReferralCode: Option.Option<ReferralCode>;
}

/** What every live checkout state carries. */
export interface CheckoutFlow extends CheckoutStartInput {
  readonly nextOperationId: CheckoutOperationId;
}

/** Who books and what the invoice needs, as the details form produced them. */
export type CheckoutDetails = Pick<
  CreateCustomerCheckout,
  "bookingFor" | "contact" | "billing" | "marketingConsent"
>;

/** A legal document's version the customer accepts, as submit sends it. */
export type AcceptedLegalDocument = Pick<CustomerLegalDocument, "key" | "hash">;

/** The held order as its latest signed checkout state describes it. */
export interface HeldCheckout {
  readonly orderId: string;
  readonly payStateToken: string;
  /**
   * When the hold ends, which the countdown shows. Codes and price
   * acceptance renew the token, never the hold.
   */
  readonly holdExpiresAt: string;
  readonly summary: CustomerCheckout["summary"];
  /** The entered code the price includes; its line can remove it. */
  readonly appliedDiscountCode: Option.Option<
    NonNullable<CustomerCheckout["appliedDiscountCode"]>
  >;
  /** The changed lines while the customer must accept a new price. */
  readonly priceReview: Option.Option<
    NonNullable<CustomerCheckout["priceReview"]>["changedKeys"]
  >;
  readonly earlyPerformanceConsent: CustomerCheckout["earlyPerformanceConsent"];
  readonly referralApplied: boolean;
}

/** The discount or referral code field. */
export interface CodeEntry {
  readonly input: string;
  readonly status: CodeStatus;
}

/**
 * - `AwaitingPriceAcceptance`: the price changed before the code could
 *   apply; after accepting it the customer applies the code again.
 * - `Rejected`: the code wasn't applied; the input stays to correct or retry.
 */
export type CodeStatus = Data.TaggedEnum<{
  Idle: Record<never, never>;
  Applying: Record<never, never>;
  Applied: {
    readonly outcome: NonNullable<
      CustomerCheckoutDiscountCodeResult["discountCode"]
    >;
  };
  AwaitingPriceAcceptance: Record<never, never>;
  Rejected: { readonly reason: CustomerDiscountCodeRejected["reason"] };
}>;
export const CodeStatus = Data.taggedEnum<CodeStatus>();

export type LegalDocuments = Data.TaggedEnum<{
  Loading: { readonly operationId: CheckoutOperationId };
  Loaded: { readonly documents: ReadonlyArray<CustomerLegalDocument> };
  Failed: Record<never, never>;
}>;
export const LegalDocuments = Data.taggedEnum<LegalDocuments>();

export type CheckoutCommand = Data.TaggedEnum<{
  CreateCheckout: {
    readonly operationId: CheckoutOperationId;
    readonly request: CreateCustomerCheckout;
    readonly referralCode: Option.Option<ReferralCode>;
  };
  LoadLegalDocuments: {
    readonly operationId: CheckoutOperationId;
    readonly locale: CustomerLocale;
  };
  ApplyDiscountCode: {
    readonly operationId: CheckoutOperationId;
    readonly request: typeof ApplyCustomerCheckoutDiscountCode.Type;
    readonly referralCode: Option.Option<ReferralCode>;
  };
  ClearDiscountCode: {
    readonly operationId: CheckoutOperationId;
    readonly request: typeof ClearCustomerCheckoutDiscountCode.Type;
  };
  AcceptPriceChange: {
    readonly operationId: CheckoutOperationId;
    readonly request: typeof AcceptCustomerCheckoutPriceChange.Type;
  };
  SubmitCheckout: {
    readonly operationId: CheckoutOperationId;
    readonly request: typeof SubmitCustomerCheckout.Type;
    readonly referralCode: Option.Option<ReferralCode>;
  };
  OpenPayment: {
    readonly operationId: CheckoutOperationId;
    readonly orderId: string;
    readonly paymentUrl: string;
    readonly returnUrl: string;
  };
  UpdateRememberedReferral: { readonly update: RememberedReferralUpdate };
  TrackBookingSubmitted: {
    readonly family: CustomerBookingSelection["family"];
  };
}>;
export const CheckoutCommand = Data.taggedEnum<CheckoutCommand>();

type Command<Tag extends CheckoutCommand["_tag"]> = Data.TaggedEnum.Value<
  CheckoutCommand,
  Tag
>;
export type CreateCheckoutCommand = Command<"CreateCheckout">;
export type ApplyDiscountCodeCommand = Command<"ApplyDiscountCode">;
export type ClearDiscountCodeCommand = Command<"ClearDiscountCode">;
export type AcceptPriceChangeCommand = Command<"AcceptPriceChange">;
export type SubmitCheckoutCommand = Command<"SubmitCheckout">;
export type OpenPaymentCommand = Command<"OpenPayment">;

/** The one write a held checkout runs at a time. */
export type ReviewMutation =
  | ApplyDiscountCodeCommand
  | ClearDiscountCodeCommand
  | AcceptPriceChangeCommand
  | SubmitCheckoutCommand;

export type DetailsNotice = Data.TaggedEnum<{
  DetailsInvalid: { readonly field: Option.Option<string> };
  Retryable: {
    readonly kind: CheckoutRetryKind;
    readonly command: CreateCheckoutCommand;
  };
}>;
export const DetailsNotice = Data.taggedEnum<DetailsNotice>();

export type ReviewNotice = Data.TaggedEnum<{
  Retryable: {
    readonly kind: CheckoutRetryKind;
    readonly command: ReviewMutation;
  };
  ConsentRequired: {
    readonly consent: Data.TaggedEnum.Value<
      BookingProblem,
      "ConsentRequired"
    >["consent"];
  };
  LegalDocumentsChanged: Record<never, never>;
}>;
export const ReviewNotice = Data.taggedEnum<ReviewNotice>();

/**
 * What the review pays for: a new booking, with who books and who is
 * invoiced as the details step submitted them, or an order whose payment
 * failed, was cancelled or expired, paid again with the details the server
 * kept for it.
 */
export type ReviewKind = Data.TaggedEnum<{
  NewBooking: { readonly details: CheckoutDetails };
  PaymentRetry: { readonly details: CustomerPaymentRetryDetails };
}>;
export const ReviewKind = Data.taggedEnum<ReviewKind>();

interface ReviewFields {
  readonly flow: CheckoutFlow;
  readonly kind: ReviewKind;
  readonly checkout: HeldCheckout;
  /**
   * The total shown before the price changed, while a price review waits;
   * none when the review opened on a changed price (the quote's total was
   * the last one shown).
   */
  readonly priceBefore: Option.Option<CustomerCheckout["summary"]["total"]>;
  readonly code: CodeEntry;
  readonly legal: LegalDocuments;
  /** The documents the ticked checkbox accepted; none while unticked. */
  readonly consent: Option.Option<ReadonlyArray<AcceptedLegalDocument>>;
  readonly pending: Option.Option<ReviewMutation>;
  readonly notice: Option.Option<ReviewNotice>;
}

interface CreatingFields {
  readonly flow: CheckoutFlow;
  readonly details: CheckoutDetails;
  readonly command: CreateCheckoutCommand;
}

/**
 * - `Details`: the contact and billing form, before any hold.
 * - `Creating`: the hold is being created.
 * - `Review`: a held order to pay: summary, code, price review, consent.
 * - `Uncertain`: a write's answer was lost; only `Retry`, which resends it
 *   unchanged, settles it. After a submit the order may be paying.
 * - `Paying`: the payment page is open.
 * - `Done`: show the order's status screen.
 * - `Restart`: the booking starts over from the family screen.
 * - `Blocked`: the account can't book.
 */
export type CheckoutState = Data.TaggedEnum<{
  Details: {
    readonly flow: CheckoutFlow;
    readonly details: Option.Option<CheckoutDetails>;
    readonly notice: Option.Option<DetailsNotice>;
  };
  Creating: CreatingFields;
  Review: ReviewFields;
  Uncertain: {
    /**
     * The state the write was sent from, holding the write: `Creating`'s
     * command, or `Review`'s pending mutation.
     */
    readonly resume: UncertainResume;
    /** Whether the resent command is waiting for its answer. */
    readonly retrying: boolean;
    /** Why the last resend failed without settling anything. */
    readonly notice: Option.Option<CheckoutRetryKind>;
  };
  Paying: {
    /**
     * The review Pay was pressed on, its submit still pending: the screen
     * keeps showing it, Pay saying the page is opening, until the payment
     * page is up and the customer comes back.
     */
    readonly review: ReviewState;
    readonly flow: CheckoutFlow;
    readonly orderId: string;
    readonly paymentUrl: string;
    readonly returnUrl: string;
    readonly opening: Option.Option<OpenPaymentCommand>;
    readonly notice: Option.Option<CheckoutRetryKind>;
  };
  Done: { readonly orderId: string };
  Restart: { readonly reason: CheckoutRestartReason };
  Blocked: { readonly reason: CheckoutBlockedReason };
}>;
export const CheckoutState = Data.taggedEnum<CheckoutState>();

export type DetailsState = Data.TaggedEnum.Value<CheckoutState, "Details">;
export type CreatingState = Data.TaggedEnum.Value<CheckoutState, "Creating">;
export type ReviewState = Data.TaggedEnum.Value<CheckoutState, "Review">;
export type UncertainState = Data.TaggedEnum.Value<CheckoutState, "Uncertain">;
export type PayingState = Data.TaggedEnum.Value<CheckoutState, "Paying">;

/** The state an unsettled write returns to once its answer arrives. */
export type UncertainResume = CreatingState | ReviewState;

/**
 * The customer's intents, the hold clock, and the answers to commands. An
 * answer names the command's `operationId`.
 */
export type CheckoutEvent = Data.TaggedEnum<{
  Continue: {
    /** New for each submission of the details form. */
    readonly checkoutAttemptId: string;
    readonly details: CheckoutDetails;
  };
  CodeChanged: { readonly input: string };
  ApplyCode: Record<never, never>;
  /** Removes the applied entered code (`HeldCheckout.appliedDiscountCode`). */
  ClearCode: Record<never, never>;
  AcceptPrice: Record<never, never>;
  ToggleConsent: { readonly accepted: boolean };
  Pay: Record<never, never>;
  Retry: Record<never, never>;
  ReloadLegalDocuments: Record<never, never>;
  /**
   * The hold countdown's tick, in epoch milliseconds. It keeps ticking, so
   * a tick `step` ignores while a submit runs comes again.
   */
  HoldTimerElapsed: { readonly now: number };
  CheckoutCreated: {
    readonly operationId: CheckoutOperationId;
    readonly start: CustomerCheckoutStart;
  };
  LegalDocumentsLoaded: {
    readonly operationId: CheckoutOperationId;
    readonly documents: ReadonlyArray<CustomerLegalDocument>;
  };
  CodeApplied: {
    readonly operationId: CheckoutOperationId;
    readonly result: CustomerCheckoutDiscountCodeResult;
  };
  CodeCleared: {
    readonly operationId: CheckoutOperationId;
    readonly checkout: CustomerCheckout;
  };
  PriceAccepted: {
    readonly operationId: CheckoutOperationId;
    readonly checkout: CustomerCheckout;
  };
  Submitted: {
    readonly operationId: CheckoutOperationId;
    readonly submission: CustomerCheckoutSubmission;
  };
  PaymentEnded: {
    readonly operationId: CheckoutOperationId;
    readonly result: PaymentBrowserResult;
  };
  CommandFailed: {
    readonly operationId: CheckoutOperationId;
    readonly problem: BookingProblem;
  };
}>;
export const CheckoutEvent = Data.taggedEnum<CheckoutEvent>();

/** A transition: the next state and the commands to run, in order. */
export interface CheckoutStep {
  readonly state: CheckoutState;
  readonly commands: ReadonlyArray<CheckoutCommand>;
}
