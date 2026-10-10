import { describe, expect, test } from "bun:test";
import { currencyCZK, formatWorkspaceMoney } from "./workspace-money";

const formatInEnglish = (value: number) =>
  formatWorkspaceMoney(currencyCZK(value), "en").replaceAll("\u00a0", " ");

describe("currencyCZK", () => {
  test("constructs CZK money from an integer minor-unit value", () => {
    expect(currencyCZK(47_500)).toEqual({
      value: 47_500,
      exponent: 2,
      currency: "CZK",
    });
  });
});

describe("formatWorkspaceMoney", () => {
  test("omits minor units for whole amounts", () => {
    expect(formatInEnglish(41_000)).toBe("CZK 410");
  });

  test("shows every minor digit of the currency for fractional amounts", () => {
    expect(formatInEnglish(30_750)).toBe("CZK 307.50");
    expect(formatInEnglish(21_755)).toBe("CZK 217.55");
  });
});
