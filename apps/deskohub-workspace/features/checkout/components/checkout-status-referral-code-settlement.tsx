import "server-only";

import { Effect } from "effect";
import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";
import { checkBookerReferralSettled } from "@/features/checkout/backend/checkout/booker-referral-settlement.server";
import { isPaidCheckoutStatus } from "@/features/checkout/paid-checkout-status";
import { ForgetRememberedReferralCode } from "@/features/referrals/forget-remembered-referral-code";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { readRememberedReferralCode } from "@/features/referrals/remembered-referral-code.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * Forgets the browser's remembered referral code once the status page shows
 * its order paid and the booker's own referral is settled: the payment
 * recorded any carried referral, and the booker's first paid order closes
 * their window. An order booked for someone else keeps the booker's code. The
 * status page is the first response that knows, because the provider return
 * only redirects here and reconciliation runs on this render. An unauthorized
 * visit shows `not_found` and keeps the code.
 */
export async function CheckoutStatusReferralCodeSettlement({
  status,
}: {
  readonly status: CheckoutStatusKind;
}) {
  if (!isPaidCheckoutStatus(status)) return null;
  const rememberedReferralCode = await readRememberedReferralCode.pipe(
    Effect.provide(ReferralFeatureFlagRequest),
    runWorkspaceEffect("checkout.remembered-referral-code", {
      boundary: "page",
    })
  );
  if (!rememberedReferralCode) return null;
  return (await checkBookerReferralSettled({ paid: true })) ? (
    <ForgetRememberedReferralCode />
  ) : null;
}
