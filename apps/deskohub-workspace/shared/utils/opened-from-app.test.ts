import { describe, expect, test } from "bun:test";
import { isOpenedFromApp, withOpenedFromApp } from "./opened-from-app";

describe("isOpenedFromApp", () => {
  test.each([
    ["native=1", true],
    ["native=1&lang=cs", true],
    ["", false],
    ["native=0", false],
    ["native=true", false],
    ["native=", false],
    ["native", false],
    ["native=1&native=1", false],
    ["native=1&native=0", false],
    ["Native=1", false],
  ])("reads %p as %p", (query, expected) => {
    expect(isOpenedFromApp(new URLSearchParams(query))).toBe(expected);
  });
});

describe("withOpenedFromApp", () => {
  test.each([
    ["/en-US/privacy-policy", "/en-US/privacy-policy?native=1"],
    ["/privacy-policy?x=1", "/privacy-policy?x=1&native=1"],
    ["/en-US/privacy-policy#rights", "/en-US/privacy-policy?native=1#rights"],
    ["/cs-CZ/cookie-policy?native=0", "/cs-CZ/cookie-policy?native=1"],
  ])("adds the signal to %p", (path, expected) => {
    expect(withOpenedFromApp(path)).toBe(expected);
    expect(
      isOpenedFromApp(new URL(expected, "https://x.invalid").searchParams)
    ).toBe(true);
  });
});
