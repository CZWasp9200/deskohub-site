import { describe, expect, test } from "bun:test";
import { isEmailAddress } from "./email-address";

describe("isEmailAddress", () => {
  test("accepts an address with a local part and a dotted domain", () => {
    expect(isEmailAddress("customer@example.com")).toBe(true);
  });

  test("refuses a value without that shape", () => {
    for (const value of [
      "",
      "customer",
      "customer@example",
      "a b@example.com",
      "@example.com",
    ]) {
      expect(isEmailAddress(value)).toBe(false);
    }
  });

  test("refuses an address longer than mail delivers", () => {
    expect(isEmailAddress(`${"a".repeat(243)}@example.com`)).toBe(false);
    expect(isEmailAddress(`${"a".repeat(242)}@example.com`)).toBe(true);
  });
});
