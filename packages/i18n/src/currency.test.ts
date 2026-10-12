import { describe, expect, test } from "bun:test";
import { formatCurrencyAmount } from "./currency";

describe("formatCurrencyAmount", () => {
  test("renders whole amounts without minor units", () => {
    expect(
      formatCurrencyAmount({
        amount: 410,
        currency: "CZK",
        locale: "en",
        fractionDigits: 2,
      })
    ).toBe("CZK 410");
    expect(
      formatCurrencyAmount({
        amount: 410,
        currency: "CZK",
        locale: "cs",
        fractionDigits: 2,
      })
    ).toBe("410 Kč");
  });

  test("pads fractional amounts to the currency's minor digits", () => {
    expect(
      formatCurrencyAmount({
        amount: 307.5,
        currency: "CZK",
        locale: "en",
        fractionDigits: 2,
      })
    ).toContain("307.50");
    expect(
      formatCurrencyAmount({
        amount: 307.5,
        currency: "CZK",
        locale: "cs",
        fractionDigits: 2,
      })
    ).toBe("307,50 Kč");
  });

  test("falls back to the Intl currency default without an exponent", () => {
    expect(
      formatCurrencyAmount({ amount: 12.5, currency: "EUR", locale: "en" })
    ).toContain("12.50");
  });
});
