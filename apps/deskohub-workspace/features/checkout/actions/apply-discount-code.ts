"use server";

import { Effect, Layer, Predicate } from "effect";
import { RedirectType, redirect } from "next/navigation";
import { env } from "@/env";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import {
  CheckoutReferralService,
  PayableCheckout,
} from "@/features/checkout/backend/checkout";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  type ApplyDiscountCodeResult,
  applyDiscountCodeToPayState,
  getDiscountCodeChangeDeadline,
} from "@/features/checkout/backend/checkout/pay-state-discount-code";
import {
  type ApplyDiscountCodeInput,
  applyDiscountCodeSchema,
} from "@/features/checkout/backend/checkout/pay-state-discount-code-input";
import { addCheckoutReferralAppliedMarker } from "@/features/checkout/checkout-referral-notice";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import type { Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import { getDiscountCodeRejectedPayPath } from "./discount-code-pay-path";

/** What the site's discount-code entry can answer. */
export type ApplyDiscountCodeActionResult =
  | ApplyDiscountCodeResult
  /** BotID rejected the request as automated; the code was not checked. */
  | { readonly status: "automated_request" };

/**
 * Screens the browser with BotID before the shared operation opens the token
 * or checks the code.
 */
const applyDiscountCodeOnSite = Effect.fn("checkout.applyDiscountCodeOnSite")(
  function* (input: ApplyDiscountCodeInput) {
    const botProtection = yield* BotProtectionService;

    // Discount code: part of the customer's own purchase, so verified customer
    // agents may enter one; unverified bots get the automated-request status.
    yield* botProtection.verifyHuman({
      verificationFailurePolicy: "deny",
      verifiedBots: { allow: customerAgentNames },
      callSite: "checkout.apply-discount-code",
    });

    const result: ApplyDiscountCodeActionResult =
      yield* applyDiscountCodeToPayState(input).pipe(
        Effect.provide(
          RememberedReferral.Cookies.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                CheckoutPricingService.Live,
                PayableCheckout.Live,
                WorkspaceReservationRepository.Live,
                ReferralService.Live,
                CheckoutReferralService.Live,
                CurrentCustomerAccount.Live,
                SealedStateKeys.Default
              )
            ),
            Layer.provideMerge(ReferralReleaseGateRequest)
          )
        )
      );
    return result;
  },
  (effect) =>
    effect.pipe(
      Effect.catchTag(
        "BotDetectedError",
        (): Effect.Effect<ApplyDiscountCodeActionResult> =>
          Effect.succeed({ status: "automated_request" })
      )
    )
);

const applyDiscountCodeAction = defineWorkspaceAction(
  {
    operation: "checkout.apply-discount-code",
    deadline: getDiscountCodeChangeDeadline(env.VERCEL_ENV),
    schema: applyDiscountCodeSchema,
  },
  applyDiscountCodeOnSite
);

const applyDiscountCode: typeof applyDiscountCodeAction = async (
  ...args: Parameters<typeof applyDiscountCodeAction>
) => {
  "use server";
  return await applyDiscountCodeAction(...args);
};

const getDiscountCodeRejection = (
  status: ApplyDiscountCodeActionResult["status"] | undefined
): DiscountCodeRejection => {
  if (status === "already_attributed") return "referral-already-attributed";
  if (status === "ineligible") return "referral-ineligible";
  if (status === "automated_request") return "automated-request";
  return "unavailable";
};

/** What the action returned; nothing when it rejected its input. */
type DiscountCodeActionData = Awaited<
  ReturnType<typeof applyDiscountCode>
>["data"];

/** The replacement Pay URL the action signed, if it returned one. */
const getFreshPayUrl = (data: DiscountCodeActionData) =>
  data && "freshPayUrl" in data ? data.freshPayUrl : undefined;

const isAcceptedReferral = (data: DiscountCodeActionData) =>
  data?.status === "accepted" || data?.status === "already_accepted";

/**
 * Where a signed replacement leads: an accepted referral also carries the
 * marker that announces it, when the URL can take one.
 */
const getReplacementPayPath = (
  data: DiscountCodeActionData,
  freshPayUrl: string,
  locale: Locale
) =>
  isAcceptedReferral(data)
    ? (addCheckoutReferralAppliedMarker(freshPayUrl, locale) ?? freshPayUrl)
    : freshPayUrl;

export async function applyDiscountCodeForm(
  locale: Locale,
  payStateToken: string,
  formData: FormData
) {
  const submittedCode = formData.get("submittedCode");
  const result = await applyDiscountCode({
    locale,
    payStateToken,
    submittedCode: Predicate.isString(submittedCode) ? submittedCode : "",
  });
  const data = result.data;
  const freshPayUrl = getFreshPayUrl(data);

  if (freshPayUrl) {
    redirect(
      getReplacementPayPath(data, freshPayUrl, locale),
      RedirectType.replace
    );
  }

  redirect(
    getDiscountCodeRejectedPayPath(
      locale,
      payStateToken,
      getDiscountCodeRejection(data?.status)
    ),
    RedirectType.replace
  );
}
