"use server";

import { Effect, Layer } from "effect";
import { CheckoutPaymentRetryService } from "@/features/checkout/backend/checkout/checkout-payment-retry.service";
import { m } from "@/features/i18n";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import {
  preparePaymentRetryForVisitor,
  preparePaymentRetrySchema,
} from "./prepare-payment-retry.server";

const preparePaymentRetryAction = defineWorkspaceAction(
  {
    operation: "checkout.prepare-payment-retry",
    fallback: m.checkoutPaymentRetryError,
    schema: preparePaymentRetrySchema,
  },
  (input) =>
    preparePaymentRetryForVisitor(input).pipe(
      Effect.provide(
        CheckoutPaymentRetryService.Live.pipe(
          Layer.provideMerge(ReferralReleaseGateRequest)
        )
      )
    )
);

export const preparePaymentRetry: typeof preparePaymentRetryAction = async (
  ...args: Parameters<typeof preparePaymentRetryAction>
) => {
  "use server";
  return await preparePaymentRetryAction(...args);
};
