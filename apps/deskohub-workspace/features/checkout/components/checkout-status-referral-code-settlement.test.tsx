import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { isValidElement, type ReactNode } from "react";
import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";
import { ForgetRememberedReferralCode } from "@/features/referrals/forget-remembered-referral-code";

let rememberedReferralCode: string | undefined;
mock.module("server-only", () => ({}));
// Bun shares module mocks across test files, so keep the module's full shape.
mock.module("@/features/referrals/remembered-referral-code.server", () => ({
  readRememberedReferralCode: Effect.sync(() => rememberedReferralCode),
  forgetRememberedReferralCode: async () => {
    rememberedReferralCode = undefined;
  },
  rememberReferralCode: async (code: string) => {
    rememberedReferralCode = code;
  },
}));
// Whether the booker's own referral is settled; a friend's never counts.
let bookerSettled = true;
const bookerChecks: { readonly paid: boolean }[] = [];
mock.module(
  "@/features/checkout/backend/checkout/booker-referral-settlement.server",
  () => ({
    checkBookerReferralSettled: async (booking: { readonly paid: boolean }) => {
      bookerChecks.push(booking);
      return bookerSettled;
    },
  })
);

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

  // While referrals are withheld the reader reports no remembered code, so a
  // code left from before stays in the browser untouched.
  test("renders nothing for a paid order without a remembered code, as while referrals are withheld", async () => {
    bookerChecks.length = 0;
    expect(await renderSettlement("fulfilled", {})).toBeNull();
    expect(bookerChecks).toEqual([]);
  });

  test("keeps the booker's code when the paid order was booked for a friend", async () => {
    bookerSettled = false;
    bookerChecks.length = 0;
    try {
      expect(await renderSettlement("fulfilled")).toBeNull();
      expect(bookerChecks).toEqual([{ paid: true }]);
    } finally {
      bookerSettled = true;
    }
  });
});
