import { describe, expect, test } from "bun:test";
import { showsFocusRing } from "./controls";

const focusedBy = (visible: boolean) => ({
  matches: (selector: string) => selector === ":focus-visible" && visible,
});

describe("Button focus ring on the web", () => {
  test("a keyboard focus (:focus-visible) draws the ring", () => {
    expect(showsFocusRing("web", focusedBy(true))).toBe(true);
  });

  test("a pointer press focuses without :focus-visible and draws no ring", () => {
    expect(showsFocusRing("web", focusedBy(false))).toBe(false);
  });

  test("native focus always draws the ring", () => {
    expect(showsFocusRing("android", focusedBy(false))).toBe(true);
  });
});
