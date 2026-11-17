import { describe, expect, test } from "bun:test";
import {
  type PriceLine,
  priceBreakdown,
  priceLineAmount,
  summaryItemSubject,
} from "./price-breakdown";
import {
  officeSixSeats,
  officeSixSeatsDiscounted,
  openSpaceWithCoffee,
  priceFixtures,
} from "./testing/price-fixtures";

const signedTotal = (lines: ReadonlyArray<PriceLine>) =>
  lines.reduce((sum, line) => sum + priceLineAmount(line).value, 0);

describe("priceBreakdown", () => {
  test.each(["not-vat-payer", "vat-payer"] as const)(
    "keeps the response's %s VAT status for the total's tax note",
    (vatStatus) => {
      expect(
        priceBreakdown({ ...openSpaceWithCoffee.summary, vatStatus }).vatStatus
      ).toBe(vatStatus);
    }
  );

  test.each(Object.entries(priceFixtures))(
    "the %s lines add up to the response's total",
    (_, { summary }) => {
      const breakdown = priceBreakdown(summary);
      expect(breakdown.total).toEqual(summary.total);
      expect(signedTotal(breakdown.lines)).toBe(summary.total.value);
      for (const line of breakdown.lines) {
        expect(line.amount.currency).toBe(summary.total.currency);
        expect(line.amount.exponent).toBe(summary.total.exponent);
      }
    }
  );

  test("leaves the final total line out", () => {
    for (const { summary } of Object.values(priceFixtures)) {
      expect(
        priceBreakdown(summary).lines.map((line) => line.key)
      ).not.toContain("total:final");
    }
  });

  test("shows a discounted line before its discount, then each discount", () => {
    const { lines } = priceBreakdown(openSpaceWithCoffee.summary);
    expect(lines.map((line) => [line._tag, line.key])).toEqual([
      ["Charge", "product:cowork:open-space"],
      ["Reduction", "product:cowork:open-space:discount:calendar-sale-2026-11"],
      ["Charge", "addon:coffee"],
    ]);
    const [product, reduction] = lines;
    expect(product?.amount.value).toBe(29_000);
    expect(reduction).toMatchObject({
      discountId: "calendar-sale-2026-11",
      label: "Calendar discount",
      amount: { value: 5800 },
    });
    expect(priceLineAmount(reduction as PriceLine).value).toBe(-5800);
  });

  test("splits an office line into access and seats", () => {
    const { lines } = priceBreakdown(officeSixSeats.summary);
    expect(lines).toEqual([
      {
        _tag: "Charge",
        key: "product:office:6:3:access",
        subject: { _tag: "OfficeAccess", dayCount: 3 },
        amount: { value: 159_000, exponent: 2, currency: "CZK" },
      },
      {
        _tag: "Charge",
        key: "product:office:6:3:seats",
        subject: { _tag: "OfficeSeats", seats: 6, dayCount: 3 },
        amount: { value: 567_000, exponent: 2, currency: "CZK" },
      },
    ]);
  });

  test("follows a discounted office's parts with its discount", () => {
    const { lines } = priceBreakdown(officeSixSeatsDiscounted.summary);
    expect(lines.map((line) => line.key)).toEqual([
      "product:office:6:3:access",
      "product:office:6:3:seats",
      "product:office:6:3:discount:office-week-10",
    ]);
  });
});

describe("summaryItemSubject", () => {
  test.each([
    [
      { key: "product:cowork:open-space" },
      { _tag: "Product", product: "cowork:open-space" },
    ],
    [{ key: "addon:coffee" }, { _tag: "Coffee" }],
    [{ key: "addon:workstation" }, { _tag: "Workstation" }],
    [
      { key: "addon:workstation", monitorOption: "2x27-qhd" },
      { _tag: "Workstation", monitorOption: "2x27-qhd" },
    ],
    [{ key: "addon:parking" }, { _tag: "Other", key: "addon:parking" }],
  ] as const)("%o", (item, subject) => {
    expect(summaryItemSubject(item)).toEqual(subject);
  });
});
