import { describe, expect, test } from "bun:test";
import { formatDiscountReduction } from "./format-discount-adjustment";

describe("formatDiscountReduction", () => {
  test.each([
    ["en-US" as const, "-25%"],
    ["cs-CZ" as const, "-25 %"],
  ])(
    "formats a percentage sale as a %s price reduction",
    (locale, expected) => {
      expect(
        formatDiscountReduction(
          { kind: "percentage", basisPoints: 2500 },
          locale
        )
      ).toBe(expected);
    }
  );

  test("keeps fractional percentages", () => {
    expect(
      formatDiscountReduction(
        { kind: "percentage", basisPoints: 1250 },
        "en-US"
      )
    ).toBe("-12.5%");
  });

  test.each([
    ["en-US" as const, "-CZK\u00a050"],
    ["cs-CZ" as const, "-50 Kč"],
  ])("formats a fixed sale as a %s price reduction", (locale, expected) => {
    expect(
      formatDiscountReduction(
        {
          kind: "fixed",
          amount: { value: 5_000, exponent: 2, currency: "CZK" },
        },
        locale
      )
    ).toBe(expected);
  });
});
