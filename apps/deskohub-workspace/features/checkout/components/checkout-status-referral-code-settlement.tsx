import "server-only";

import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";
import { isPaidCheckoutStatus } from "@/features/checkout/paid-checkout-status";
import { ForgetRememberedReferralCode } from "@/features/referrals/forget-remembered-referral-code";
import { readRememberedReferralCode } from "@/features/referrals/remembered-referral-code.server";

/**
 * Forgets the browser's remembered referral code once the status page shows
 * its order paid: the payment recorded any carried referral, and a first paid
 * order closes the referral window anyway. The status page is the first
 * response that knows, because the provider return only redirects here and
 * reconciliation runs on this render. An unauthorized visit shows `not_found`
 * and keeps the code.
 */
export async function CheckoutStatusReferralCodeSettlement({
  status,
}: {
  readonly status: CheckoutStatusKind;
}) {
  if (!isPaidCheckoutStatus(status)) return null;
  const rememberedReferralCode = await readRememberedReferralCode();
  return rememberedReferralCode ? <ForgetRememberedReferralCode /> : null;
}
