"use server";

import { Effect } from "effect";
import { CheckoutPaymentPageService } from "@/features/checkout/backend/checkout/checkout-payment-page.service";
import { m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import {
  reopenPaymentPageForVisitor,
  reopenPaymentPageSchema,
} from "./reopen-payment-page.server";

const reopenPaymentPageAction = defineWorkspaceAction(
  {
    operation: "checkout.reopen-payment-page",
    fallback: m.checkoutStatusOpenPaymentPageError,
    schema: reopenPaymentPageSchema,
  },
  (input) =>
    reopenPaymentPageForVisitor(input).pipe(
      Effect.provide(CheckoutPaymentPageService.Live)
    )
);

export const reopenPaymentPage: typeof reopenPaymentPageAction = async (
  ...args: Parameters<typeof reopenPaymentPageAction>
) => {
  "use server";
  return await reopenPaymentPageAction(...args);
};
