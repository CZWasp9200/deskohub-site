import { describe, expect, mock, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";
import { ForgetRememberedReferralCode } from "@/features/referrals/forget-remembered-referral-code";

let rememberedReferralCode: string | undefined;
mock.module("server-only", () => ({}));
mock.module("@/features/referrals/remembered-referral-code.server", () => ({
  readRememberedReferralCode: async () => rememberedReferralCode,
}));

const renderSettlement = async (
  status: CheckoutStatusKind,
  cookie: { readonly code?: string } = { code: "RFL12345" }
) => {
  rememberedReferralCode = cookie.code;
  const { CheckoutStatusReferralCodeSettlement } = await import(
    "./checkout-status-referral-code-settlement"
  );
  return await CheckoutStatusReferralCodeSettlement({ status });
};

const forgetsRememberedCode = (element: ReactNode) =>
  isValidElement(element) && element.type === ForgetRememberedReferralCode;

describe("CheckoutStatusReferralCodeSettlement", () => {
  test.each([
    "paid_waiting_fulfillment",
    "paid_fulfillment_delayed",
    "paid_awaiting_delivery",
    "paid_delivery_delayed",
    "fulfilled",
    "fulfillment_failed",
  ] as const)(
    "forgets the remembered code once the order is %s",
    async (status) => {
      expect(forgetsRememberedCode(await renderSettlement(status))).toBe(true);
    }
  );

  test.each([
    "not_found",
    "created",
    "pending",
    "payment_pending_delayed",
    "payment_failed",
    "cancelled",
    "expired",
    "late_payment_checking",
    "late_payment_refund",
    "late_payment_review",
  ] as const)(
    "keeps the remembered code while the order is %s",
    async (status) => {
      expect(await renderSettlement(status)).toBeNull();
    }
  );

  test("renders nothing for a paid order without a remembered code", async () => {
    expect(await renderSettlement("fulfilled", {})).toBeNull();
  });
});
