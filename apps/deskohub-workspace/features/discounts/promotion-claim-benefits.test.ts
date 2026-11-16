import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Schema } from "effect";
import {
  type AppliedDiscount,
  type DiscountAdjustment,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import { getPromotionTiming } from "@/features/discounts/promotion-code";
import { m } from "@/features/i18n";
import { getReferralBenefitIds } from "@/features/referrals/referral-benefits";
import {
  discountAdjustmentsEqual,
  promotionTimingChanged,
  voucherCreditChanged,
  voucherPresentationChanged,
} from "./promotion-claim-benefits";

const czk = (value: number) => ({ value, exponent: 2, currency: "CZK" });
const invited = "100000001" as DotyposCustomerId;

const applied = (
  discount: Partial<AppliedDiscount["discount"]>,
  amount = 5250
): AppliedDiscount => ({
  discount: {
    id: Schema.decodeUnknownSync(discountIdSchema)("discount-1"),
    label: "Discount",
    adjustment: { kind: "percentage", basisPoints: 1500 },
    ...discount,
  },
  subtotalBefore: czk(35_000),
  amount: czk(amount),
  subtotalAfter: czk(35_000 - amount),
});

describe("discountAdjustmentsEqual", () => {
  const cases: readonly [DiscountAdjustment, DiscountAdjustment, boolean][] = [
    [
      { kind: "percentage", basisPoints: 1000 },
      { kind: "percentage", basisPoints: 1000 },
      true,
    ],
    [
      { kind: "percentage", basisPoints: 1000 },
      { kind: "percentage", basisPoints: 1500 },
      false,
    ],
    [
      { kind: "fixed", amount: czk(500) },
      { kind: "fixed", amount: czk(500) },
      true,
    ],
    [
      { kind: "fixed", amount: czk(500) },
      { kind: "fixed", amount: { ...czk(500), currency: "EUR" } },
      false,
    ],
    [
      { kind: "percentage", basisPoints: 500 },
      { kind: "fixed", amount: czk(500) },
      false,
    ],
  ];

  test.each(cases)("compares %o with %o", (left, right, equal) => {
    expect(discountAdjustmentsEqual(left, right)).toBe(equal);
    expect(discountAdjustmentsEqual(right, left)).toBe(equal);
  });
});

describe("promotionTimingChanged", () => {
  const until = Temporal.Instant.from("2026-12-01T10:00:00Z");

  test("matches a discount carrying the promotion's deadline", () => {
    expect(
      promotionTimingChanged(
        getPromotionTiming(until),
        applied(getPromotionTiming(until)).discount
      )
    ).toBe(false);
    expect(
      promotionTimingChanged(getPromotionTiming(null), applied({}).discount)
    ).toBe(false);
  });

  test("differs when either the deadline or the countdown moved", () => {
    const timing = getPromotionTiming(until);
    expect(promotionTimingChanged(timing, applied({}).discount)).toBe(true);
    expect(
      promotionTimingChanged(
        timing,
        applied({ ...timing, countdownStartsAt: timing.expiresAt }).discount
      )
    ).toBe(true);
  });
});

describe("voucher credit and presentation", () => {
  const claim = {
    kind: "voucher" as const,
    voucherId: "voucher-1" as never,
    availableAmount: czk(10_000),
    dotyposCustomerId: invited,
  };
  const credit = (
    discount: Partial<AppliedDiscount["discount"]> = {},
    amount = 10_000
  ) =>
    applied(
      {
        id: deriveOpaqueDiscountId({
          providerNamespace: "database-voucher",
          providerReference: claim.voucherId,
        }),
        label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
        adjustment: { kind: "fixed", amount: czk(10_000) },
        ...discount,
      },
      amount
    );

  test("keeps credit that still matches the voucher", () => {
    expect(
      voucherCreditChanged({
        claim,
        application: credit(),
        availableAmount: czk(10_000),
      })
    ).toBe(false);
    expect(
      voucherCreditChanged({
        claim,
        application: credit({}, 4000),
        availableAmount: czk(10_000),
      })
    ).toBe(false);
  });

  test.each([
    ["less available credit", credit(), czk(6000)],
    [
      "a percentage adjustment",
      credit({ adjustment: { kind: "percentage", basisPoints: 1000 } }),
      czk(10_000),
    ],
    [
      "another fixed amount",
      credit({ adjustment: { kind: "fixed", amount: czk(9000) } }),
      czk(10_000),
    ],
    ["an application above the credit", credit({}, 10_001), czk(10_000)],
  ] as const)("credit changes with %s", (_case, application, available) => {
    expect(
      voucherCreditChanged({ claim, application, availableAmount: available })
    ).toBe(true);
  });

  test("presentation matches the voucher's id, label and deadline", () => {
    const timing = getPromotionTiming(
      Temporal.Instant.from("2026-12-01T10:00:00Z")
    );
    expect(
      voucherPresentationChanged({
        claim,
        application: credit(timing),
        locale: "en-US",
        timing,
      })
    ).toBe(false);
    expect(
      voucherPresentationChanged({
        claim,
        application: credit({ id: getReferralBenefitIds(invited).invitation }),
        locale: "en-US",
        timing: {},
      })
    ).toBe(true);
    expect(
      voucherPresentationChanged({
        claim,
        application: credit({}),
        locale: "cs-CZ",
        timing: {},
      })
    ).toBe(true);
    expect(
      voucherPresentationChanged({
        claim,
        application: credit({}),
        locale: "en-US",
        timing,
      })
    ).toBe(true);
  });
});
