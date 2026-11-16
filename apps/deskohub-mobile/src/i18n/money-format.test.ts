import { describe, expect, test } from "bun:test";
import {
  formatMoney,
  formatMoneyReduction,
  minorUnitsText,
} from "./money-format";

describe("minorUnitsText", () => {
  test.each([
    [45000, 2, "450.00"],
    [12_350, 2, "123.50"],
    [5, 2, "0.05"],
    [0, 2, "0.00"],
    [-1250, 2, "-12.50"],
    [1234, 0, "1234"],
    [400, 0, "400"],
    [7, 3, "0.007"],
  ])("%d at exponent %d reads %s", (value, exponent, text) => {
    expect(minorUnitsText({ value, exponent })).toBe(text);
  });
});

const intlCzk = (amount: number, locale: string, fractionDigits: number) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);

describe("formatMoney", () => {
  test("formats a fractional amount with the currency's minor units", () => {
    expect(
      formatMoney({ value: 123450, exponent: 2, currency: "CZK" }, "cs-CZ")
    ).toBe(intlCzk(1234.5, "cs-CZ", 2));
  });

  test("drops the minor units of a whole amount", () => {
    expect(
      formatMoney({ value: 28200, exponent: 2, currency: "CZK" }, "en-US")
    ).toBe(intlCzk(282, "en-US", 0));
  });
});

describe("formatMoneyReduction", () => {
  test("is the amount after a minus sign and a space, whatever the sign", () => {
    const amount = intlCzk(58, "en-US", 0);
    for (const value of [5800, -5800]) {
      expect(
        formatMoneyReduction({ value, exponent: 2, currency: "CZK" }, "en-US")
      ).toBe(`− ${amount}`);
    }
  });
});
