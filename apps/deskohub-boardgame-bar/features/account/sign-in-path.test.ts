import { describe, expect, it } from "bun:test";
import { safeReturnPath, signInHref } from "./sign-in-path";

describe("safeReturnPath", () => {
  it("keeps same-site paths", () => {
    expect(safeReturnPath("/events?month=2026-12")).toBe(
      "/events?month=2026-12"
    );
  });

  it("falls back to the account page for anything that leaves the site", () => {
    expect(safeReturnPath(undefined)).toBe("/account");
    expect(safeReturnPath("https://evil.example")).toBe("/account");
    expect(safeReturnPath("//evil.example")).toBe("/account");
    expect(safeReturnPath("/\\evil.example")).toBe("/account");
  });
});

describe("signInHref", () => {
  it("encodes the return path", () => {
    expect(signInHref("/events?month=2026-12")).toBe(
      "/sign-in?next=%2Fevents%3Fmonth%3D2026-12"
    );
  });
});
