import type { CustomerCheckout } from "@deskohub/workspace-customer-api";
import type { PayStateCheckoutView } from "@/features/checkout/backend/checkout/pay-state-checkout-view";
import { toCustomerCheckoutSummary } from "./customer-checkout-summary";

/**
 * The checkout a Pay state's view describes, with its token and what the
 * request changed about the client's referral code.
 */
export const toCustomerCheckout = (
  view: PayStateCheckoutView,
  payStateToken: string,
  facts: Pick<
    CustomerCheckout,
    "referralApplied" | "rememberReferralCode" | "rememberedReferralCodeUsed"
  > = {}
): CustomerCheckout => ({
  status: view.changedKeys === undefined ? "ready" : "price_review",
  orderId: view.orderId,
  payStateToken,
  expiresAt: view.expiresAt,
  holdExpiresAt: view.holdExpiresAt,
  summary: toCustomerCheckoutSummary(view.summary),
  ...(view.appliedDiscountCode !== undefined && {
    appliedDiscountCode: view.appliedDiscountCode,
  }),
  ...(view.changedKeys !== undefined && {
    priceReview: { changedKeys: view.changedKeys },
  }),
  earlyPerformanceConsent: view.earlyPerformanceConsent,
  ...(view.people !== undefined && {
    people: {
      contactAttends: view.people.contactAttends,
      invitees: [...view.people.invitees],
    },
  }),
  ...(facts.referralApplied && { referralApplied: true }),
  ...(facts.rememberReferralCode !== undefined && {
    rememberReferralCode: facts.rememberReferralCode,
  }),
  ...(facts.rememberedReferralCodeUsed && {
    rememberedReferralCodeUsed: true,
  }),
});
