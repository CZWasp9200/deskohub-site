import { Effect } from "effect";
import { ReferralService } from "@/features/referrals";
import type { ReferralCode } from "@/features/referrals/client";
import type { LinkedCustomerAccount } from "../customer-account";

/**
 * Whether the referral code this browser remembers is used up for the
 * customer: their referral is recorded, or a paid booking closed the window.
 * Without a remembered code there is nothing to forget, so the customer's
 * history is not read. A failed check keeps the code and never blocks the
 * caller.
 */
export const isRememberedReferralCodeUsed = Effect.fn(
  "account.isRememberedReferralCodeUsed"
)(function* (
  rememberedCode: ReferralCode | undefined,
  account: LinkedCustomerAccount
) {
  if (rememberedCode === undefined) return false;

  const referrals = yield* ReferralService;
  return yield* referrals
    .hasSettledReferral({ dotyposCustomerId: account.dotyposCustomerId })
    .pipe(
      Effect.catchCause(() =>
        Effect.logWarning("Remembered referral code was kept").pipe(
          Effect.annotateLogs({ code: "account.remembered-referral.unknown" }),
          Effect.as(false)
        )
      )
    );
});
