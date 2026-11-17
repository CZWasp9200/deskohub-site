"use server";

import { Effect, Layer } from "effect";
import { RedirectType, redirect } from "next/navigation";
import { env } from "@/env";
import { PayableCheckout } from "@/features/checkout/backend/checkout";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  type ClearDiscountCodeResult,
  clearDiscountCodeFromPayState,
  getDiscountCodeChangeDeadline,
} from "@/features/checkout/backend/checkout/pay-state-discount-code";
import {
  type ClearDiscountCodeInput,
  clearDiscountCodeSchema,
} from "@/features/checkout/backend/checkout/pay-state-discount-code-input";
import type { Locale } from "@/features/i18n";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import { getDiscountCodeRejectedPayPath } from "./discount-code-pay-path";

/** What removing the entered code on the site can answer. */
export type ClearDiscountCodeActionResult =
  | ClearDiscountCodeResult
  /** BotID rejected the request as automated; the Pay state was not opened. */
  | { readonly status: "automated_request" };

/**
 * Screens the browser with BotID before the shared operation opens the token
 * or reprices the order.
 */
const clearDiscountCodeOnSite = Effect.fn("checkout.clearDiscountCodeOnSite")(
  function* (input: ClearDiscountCodeInput) {
    const botProtection = yield* BotProtectionService;

    // Removing a discount code is part of the customer's own purchase, like
    // entering one, so verified customer agents may; unverified bots get the
    // automated-request status.
    yield* botProtection.verifyHuman({
      verificationFailurePolicy: "deny",
      verifiedBots: { allow: customerAgentNames },
      callSite: "checkout.clear-discount-code",
    });

    const result: ClearDiscountCodeActionResult =
      yield* clearDiscountCodeFromPayState(input).pipe(
        Effect.provide(
          Layer.mergeAll(
            CheckoutPricingService.Live,
            PayableCheckout.Live,
            WorkspaceReservationRepository.Live,
            SealedStateKeys.Default
          ).pipe(Layer.provideMerge(ReferralReleaseGateRequest))
        )
      );
    return result;
  },
  (effect) =>
    effect.pipe(
      Effect.catchTag(
        "BotDetectedError",
        (): Effect.Effect<ClearDiscountCodeActionResult> =>
          Effect.succeed({ status: "automated_request" })
      )
    )
);

const clearDiscountCodeAction = defineWorkspaceAction(
  {
    operation: "checkout.clear-discount-code",
    deadline: getDiscountCodeChangeDeadline(env.VERCEL_ENV),
    schema: clearDiscountCodeSchema,
  },
  clearDiscountCodeOnSite
);

const clearDiscountCode: typeof clearDiscountCodeAction = async (
  ...args: Parameters<typeof clearDiscountCodeAction>
) => {
  "use server";
  return await clearDiscountCodeAction(...args);
};

/**
 * Removes the entered code and opens the Pay state it signed, which asks the
 * customer to review the new price. A removal that fails keeps the current
 * Pay state with the code box's generic error.
 */
export async function clearDiscountCodeForm(
  locale: Locale,
  payStateToken: string
) {
  const result = await clearDiscountCode({ locale, payStateToken });
  const data = result.data;
  const freshPayUrl =
    data && "freshPayUrl" in data ? data.freshPayUrl : undefined;

  if (freshPayUrl) redirect(freshPayUrl, RedirectType.replace);

  redirect(
    getDiscountCodeRejectedPayPath(
      locale,
      payStateToken,
      data?.status === "automated_request" ? "automated-request" : "unavailable"
    ),
    RedirectType.replace
  );
}
