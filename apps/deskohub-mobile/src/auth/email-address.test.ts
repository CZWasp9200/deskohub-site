import { describe, expect, test } from "bun:test";
import { EMAIL_TEST_DOMAIN, testEmailAddress } from "@deskohub/test-email";
import { isEmailAddress } from "./email-address";

describe("isEmailAddress", () => {
  test("accepts an address with a local part and a dotted domain", () => {
    expect(isEmailAddress(testEmailAddress("customer"))).toBe(true);
  });

  test("refuses a value without that shape", () => {
    for (const value of [
      "",
      "customer",
      ["customer", "deskohub"].join("@"),
      testEmailAddress("a b"),
      ["", EMAIL_TEST_DOMAIN].join("@"),
    ]) {
      expect(isEmailAddress(value)).toBe(false);
    }
  });

  test("refuses an address longer than mail delivers", () => {
    // The domain and its "@" take the rest of the 254 characters.
    const longest = 254 - EMAIL_TEST_DOMAIN.length - 1;
    expect(isEmailAddress(testEmailAddress("a".repeat(longest)))).toBe(true);
    expect(isEmailAddress(testEmailAddress("a".repeat(longest + 1)))).toBe(
      false
    );
  });
});
