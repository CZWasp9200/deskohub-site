import { describe, expect, test } from "bun:test";
import { onboardingFieldPairsFit } from "./onboarding-layout";

describe("wide onboarding field pairs", () => {
  test("need room for the gutters, the gap and both fields", () => {
    expect(onboardingFieldPairsFit(600, 1)).toBe(false);
    expect(onboardingFieldPairsFit(663, 1)).toBe(false);
    expect(onboardingFieldPairsFit(664, 1)).toBe(true);
    expect(onboardingFieldPairsFit(840, 1)).toBe(true);
  });

  test("stack at large font sizes even on an expanded window", () => {
    expect(onboardingFieldPairsFit(1280, 1.3)).toBe(false);
    expect(onboardingFieldPairsFit(1280, 2)).toBe(false);
  });
});
