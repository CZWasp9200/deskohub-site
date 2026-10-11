import { Data } from "effect";
import type { ReferralCode } from "./client";

export type ReferralAcceptance =
  | { readonly kind: "accepted" }
  | { readonly kind: "already_accepted" };

export type ReferralCodeKind =
  | { readonly kind: "referral" }
  | { readonly kind: "other" };

export type ReferralAccountSummary = {
  readonly code: ReferralCode;
  readonly eligibleInviteeCount: number;
  /** Exact percentage represented as a canonical decimal, without a percent sign. */
  readonly discount: string;
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
