import { describe, expect, test } from "bun:test";
import {
  getRestorationRefund,
  type RestorationRefundAttempt,
} from "./reservation-restoration-refund";

const paid = {
  amountExponent: 2,
  amountValue: 50_000,
  currency: "CZK",
  refundState: "not_required",
  refundedAmountValue: null,
  state: "paid",
} satisfies RestorationRefundAttempt;

describe("restoration refund", () => {
  test("reports nothing for a payment that wasn't refunded", () => {
    expect(getRestorationRefund([paid])).toEqual({
      clearsRefundRequirement: false,
      refundedPayment: null,
    });
  });

  test("clears a refund requirement Nexi hasn't recorded", () => {
    expect(
      getRestorationRefund([{ ...paid, refundState: "required" }])
    ).toEqual({ clearsRefundRequirement: true, refundedPayment: null });
  });

  test("reports a full refund", () => {
    expect(
      getRestorationRefund([
        { ...paid, refundState: "refunded", refundedAmountValue: 50_000 },
      ])
    ).toEqual({
      clearsRefundRequirement: false,
      refundedPayment: {
        amount: { value: 50_000, exponent: 2, currency: "CZK" },
        coverage: "full",
      },
    });
  });

  test("reports a partial refund with the refunded total", () => {
    expect(
      getRestorationRefund([
        { ...paid, refundState: "refunded", refundedAmountValue: 20_000 },
      ]).refundedPayment
    ).toEqual({
      amount: { value: 20_000, exponent: 2, currency: "CZK" },
      coverage: "partial",
    });
  });

  test("counts a paid attempt kept in full as a partial refund", () => {
    expect(
      getRestorationRefund([
        { ...paid, refundState: "refunded", refundedAmountValue: 50_000 },
        paid,
        { ...paid, state: "failed" },
      ]).refundedPayment
    ).toEqual({
      amount: { value: 50_000, exponent: 2, currency: "CZK" },
      coverage: "partial",
    });
  });

  test("sums refunds across attempts and still clears an unrecorded one", () => {
    expect(
      getRestorationRefund([
        { ...paid, refundState: "refunded", refundedAmountValue: 50_000 },
        { ...paid, refundState: "refunded", refundedAmountValue: 50_000 },
        { ...paid, refundState: "required" },
      ])
    ).toEqual({
      clearsRefundRequirement: true,
      refundedPayment: {
        amount: { value: 100_000, exponent: 2, currency: "CZK" },
        coverage: "partial",
      },
    });
  });
});
