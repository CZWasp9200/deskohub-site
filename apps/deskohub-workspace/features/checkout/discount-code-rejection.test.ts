import { describe, expect, test } from "bun:test";
import { m } from "@/features/i18n";
import {
  getDiscountCodeRejectionMessage,
  parseDiscountCodeRejection,
} from "./discount-code-rejection";

describe("parseDiscountCodeRejection", () => {
  test.each([
    "unavailable",
    "referral-already-attributed",
    "referral-ineligible",
  ] as const)("accepts the %s Pay-page error value", (value) => {
    expect(parseDiscountCodeRejection(value)).toBe(value);
  });

  test.each([undefined, "", "UNAVAILABLE", "already_attributed"])(
    "shows no error for the untrusted value %p",
    (value) => {
      expect(parseDiscountCodeRejection(value)).toBeUndefined();
    }
  );
});

describe("getDiscountCodeRejectionMessage", () => {
  test.each([
    ["unavailable", m.checkoutDiscountCodeUnavailable],
    ["referral-already-attributed", m.checkoutReferralCodeAlreadyAttributed],
    ["referral-ineligible", m.checkoutReferralCodeIneligible],
  ] as const)("localizes the %s rejection", (rejection, message) => {
    expect(getDiscountCodeRejectionMessage(rejection, "cs-CZ")).toBe(
      message({}, { locale: "cs-CZ" })
    );
  });
});
