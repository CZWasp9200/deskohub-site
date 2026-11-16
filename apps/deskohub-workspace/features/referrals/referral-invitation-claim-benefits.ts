import type { AppliedDiscount } from "@/features/discounts/contracts";
import type { PromotionCodeId } from "@/features/discounts/persistence-contracts";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import type { Locale } from "@/features/i18n";
import {
  getReferralInvitationLabel,
  recognizeReferralBenefit,
} from "./referral-benefits";

// Compares the benefit a payment attempt accepted with what its referral
// invitation claim may still grant, so `ReferralInvitationLedger.admit`
// refuses a benefit that changed meanwhile. Code and voucher benefits compare
// in `@/features/discounts/promotion-claim-benefits`.

/** A referral invitation claim, as a payment commitment carries it. */
export type ReferralInvitationClaim = Extract<
  DiscountClaimInstruction,
  { readonly kind: "referral_invitation" }
>;

/** Whether an attribution recorded since pricing names another referral. */
export const isAttributedToAnotherReferral = (
  attribution:
    | {
        readonly referrerDotyposCustomerId: string;
        readonly promotionCodeId: PromotionCodeId | null;
      }
    | undefined,
  claim: ReferralInvitationClaim
) =>
  attribution !== undefined &&
  (attribution.referrerDotyposCustomerId !== claim.referrerDotyposCustomerId ||
    attribution.promotionCodeId !== claim.promotionCodeId);

/**
 * Whether the accepted invitation is no longer the invited customer's own
 * positive 15% invitation discount from another customer.
 */
export const referralInvitationBenefitChanged = (input: {
  readonly claim: ReferralInvitationClaim;
  readonly application: AppliedDiscount;
  readonly locale: Locale;
}) => {
  const recognition = recognizeReferralBenefit({
    dotyposCustomerId: input.claim.invitedDotyposCustomerId,
    discount: input.application.discount,
  });
  return (
    input.claim.invitedDotyposCustomerId ===
      input.claim.referrerDotyposCustomerId ||
    recognition.kind !== "invitation" ||
    !recognition.offersProgramRate ||
    input.application.discount.label !==
      getReferralInvitationLabel(input.locale) ||
    input.application.amount.value <= 0
  );
};
