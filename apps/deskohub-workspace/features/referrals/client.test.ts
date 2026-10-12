import { describe, expect, test } from "bun:test";
import { formatReferralDiscount, parseReferralCode } from "./client";

describe("referral code client contract", () => {
  test("accepts the canonical shared promotion-code fixture", () => {
    expect(parseReferralCode("RFL12345")).toBe("RFL12345");
  });

  test.each([
    "rfl12345",
    " RFL12345",
    "RFL12345 ",
    "RF",
    "REFERRAL CODE",
    "RFL12345?next=/account",
    12345,
    null,
  ])("rejects noncanonical referral input %p", (value) => {
    expect(parseReferralCode(value)).toBeUndefined();
  });
});

describe("referral discount formatting", () => {
  test.each([
    ["en-US", "0", "0%"],
    ["en-US", "14.2625", "14.2625%"],
    ["en-US", "18.549375", "18.5494%"],
    ["cs-CZ", "9.75", "9,75 %"],
  ] as const)("formats %s %s as %p", (locale, discount, formatted) => {
    expect(formatReferralDiscount(discount, locale)).toBe(formatted);
  });
});
