import { describe, expect, test } from "bun:test";
import { formatCurrencyAmount } from "./currency";

const formatWithDigits = (
  amount: number,
  locale: string,
  currency: string,
  digits?: number
) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...(digits !== undefined && {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
  }).format(amount);

describe("formatCurrencyAmount", () => {
  test("renders whole amounts without minor units", () => {
    for (const locale of ["en", "cs"]) {
      expect(
        formatCurrencyAmount({
          amount: 410,
          currency: "CZK",
          locale,
          fractionDigits: 2,
        })
      ).toBe(formatWithDigits(410, locale, "CZK", 0));
    }
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
    ).toBe(formatWithDigits(307.5, "cs", "CZK", 2));
  });

  test("falls back to the Intl currency default without an exponent", () => {
    expect(
      formatCurrencyAmount({ amount: 12.5, currency: "EUR", locale: "en" })
    ).toBe(formatWithDigits(12.5, "en", "EUR"));
    expect(
      formatCurrencyAmount({ amount: 12.5, currency: "EUR", locale: "en" })
    ).toContain("12.50");
  });
});
