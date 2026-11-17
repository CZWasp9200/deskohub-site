import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { wholeAddress } from "./whole-address";

describe("wholeAddress", () => {
  test("leaves no hyphen a line could break after", () => {
    const shown = wholeAddress(testEmailAddress("sign-in-toast"));

    expect(shown).not.toContain("-");
    expect(shown.replaceAll("‑", "-")).toBe(testEmailAddress("sign-in-toast"));
  });

  test("keeps an address without hyphens as it is", () => {
    expect(wholeAddress(testEmailAddress("ada"))).toBe(testEmailAddress("ada"));
  });
});
