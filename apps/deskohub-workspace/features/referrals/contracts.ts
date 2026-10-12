import { Data } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { ReferralCode } from "./client";

export type ReferralAcceptance =
  | { readonly kind: "accepted" }
  | { readonly kind: "already_accepted" };

/**
 * A referral code a checkout may carry for its customer. `eligible` means the
 * invitation can be priced and attributed when the order is paid;
 * `already_accepted` means the customer is already attributed to that
 * referrer, so the code adds nothing to carry.
 */
export type CheckoutReferralEvaluation =
  | { readonly kind: "eligible"; readonly code: ReferralCode }
  | { readonly kind: "already_accepted" };

export type ReferralCodeKind =
  | { readonly kind: "referral" }
  | { readonly kind: "other" };

export type ReferralAccountSummary = {
  readonly code: ReferralCode;
  /** Every customer who joined with this customer's referral. */
  readonly inviteeCount: number;
  /** Invited customers who currently count toward the referrer discount. */
  readonly eligibleInviteeCount: number;
  /** Exact percentage represented as a canonical decimal, without a percent sign. */
  readonly discount: string;
  /**
   * Referral discounts applied to this customer's own paid bookings, less
   * the refunded share of each payment, one positive total per currency,
   * ordered by currency code. Empty when referrals have saved nothing yet.
   */
  readonly savings: readonly WorkspaceMoney[];
};

/** The account referral summary with the customer's absolute share link. */
export type ReferralAccountOverview = {
  readonly summary: ReferralAccountSummary;
  readonly shareUrl: string;
};

type ReferralFailureReason =
  | "invalid_code"
  | "unavailable"
  | "self_referral"
  | "already_attributed"
  | "ineligible"
  | "account_unavailable";

export class ReferralError extends Data.TaggedError("ReferralError")<{
  readonly reason: ReferralFailureReason;
}> {}
