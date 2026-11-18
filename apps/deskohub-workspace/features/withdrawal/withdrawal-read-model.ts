import type { Money } from "@/shared/money/money";
import type {
  WithdrawalRefundBasis,
  WithdrawalRefusalReason,
} from "./withdrawal-assessment";
import type {
  WithdrawableContractKind,
  WithdrawalId,
} from "./withdrawal-identifiers";

/** What a customer confirms before withdrawing, and what they'd get back. */
export type WithdrawalQuote = {
  readonly contractId: string;
  readonly contractLabel: string;
  /** The customer's profile name, when it has one. */
  readonly customerName: string | null;
  /** The account's login email, where the receipt goes. */
  readonly receiptEmail: string;
  readonly paidAmount: Money;
  readonly refundAmount: Money;
  readonly refundBasis: WithdrawalRefundBasis;
  readonly periodEndsAt: Temporal.Instant;
};

/** The confirmation of a submitted withdrawal. */
export type WithdrawalReceipt = {
  readonly withdrawalId: WithdrawalId;
  readonly submittedAt: Temporal.Instant;
  readonly refundAmount: Money;
  readonly receiptEmail: string;
};

/** Why a withdrawal can't be quoted or submitted for the customer. */
export type WithdrawalRefusal =
  | WithdrawalRefusalReason
  /** No such contract, or not the customer's to withdraw from. */
  | "not_found"
  /** The customer already withdrew from this contract. */
  | "already_withdrawn";

/** A quote as a client receives it: instants as ISO strings. */
export type WithdrawalQuoteData = Omit<WithdrawalQuote, "periodEndsAt"> & {
  readonly periodEndsAt: string;
};

/** A receipt as a client receives it: instants as ISO strings. */
export type WithdrawalReceiptData = Omit<WithdrawalReceipt, "submittedAt"> & {
  readonly submittedAt: string;
};

export const toWithdrawalQuoteData = (
  quote: WithdrawalQuote
): WithdrawalQuoteData => ({
  ...quote,
  periodEndsAt: quote.periodEndsAt.toString(),
});

export const toWithdrawalReceiptData = (
  receipt: WithdrawalReceipt
): WithdrawalReceiptData => ({
  ...receipt,
  submittedAt: receipt.submittedAt.toString(),
});

/**
 * A reservation's withdrawal entry point as the account shows it: whether the
 * customer can withdraw now, and until when the period runs.
 */
export type WithdrawalAvailability = {
  readonly eligible: boolean;
  readonly periodEndsAt: string;
};

/**
 * A reservation's online withdrawal as its status page shows it: the
 * customer withdrew (with what it owes back), can withdraw now, or neither.
 */
export type ReservationWithdrawalEntry =
  | { readonly status: "withdrawn"; readonly refundAmount: Money }
  | { readonly status: "offered" }
  | { readonly status: "none" };

/**
 * A withdrawal as the customer's account data export holds it: which
 * contract, when it was submitted, what it owes back, and whether its
 * receipt, notice and cancellation are all done (`completed`) or still being
 * processed (`processing`). No receipt email is stored, so none is exported.
 */
export type WithdrawalRecord = {
  readonly contractKind: WithdrawableContractKind;
  readonly contractId: string;
  readonly contractLabel: string;
  readonly submittedAt: Temporal.Instant;
  readonly paidAmount: Money;
  readonly refundAmount: Money;
  readonly status: "processing" | "completed";
};
