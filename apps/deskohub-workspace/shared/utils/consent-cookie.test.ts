import { describe, expect, test } from "bun:test";
import {
  getAcceptedConsentCategoriesFromCookie,
  getAcceptedConsentCategoriesFromCookieValue,
  isConsentCategoryAcceptedInCookie,
  type UnexpectedConsentCookieReason,
} from "./consent-cookie";

describe("getAcceptedConsentCategoriesFromCookie", () => {
  test("reads accepted categories from the CookieConsent cookie", () => {
    const cookie = `foo=bar; cc_cookie=${encodeURIComponent(
      JSON.stringify({ categories: ["analytics", "necessary"] })
    )}`;

    expect(getAcceptedConsentCategoriesFromCookie(cookie)).toEqual([
      "analytics",
      "necessary",
    ]);
  });

  test("ignores invalid or unknown values", () => {
    const cookie = `cc_cookie=${encodeURIComponent(
      JSON.stringify({ categories: ["analytics", "unknown", 1] })
    )}`;

    const reasons: UnexpectedConsentCookieReason[] = [];

    expect(
      getAcceptedConsentCategoriesFromCookie(cookie, {
        onUnexpectedValue: (reason) => reasons.push(reason),
      })
    ).toEqual(["analytics"]);

    expect(reasons).toEqual(["unknown_category", "invalid_category_type"]);
  });

  test("warns when the consent cookie shape is unexpected", () => {
    const reasons: UnexpectedConsentCookieReason[] = [];

    expect(
      getAcceptedConsentCategoriesFromCookieValue("not-json", {
        onUnexpectedValue: (reason) => reasons.push(reason),
      })
    ).toEqual([]);
    expect(
      getAcceptedConsentCategoriesFromCookieValue(
        JSON.stringify({ categories: "analytics" }),
        { onUnexpectedValue: (reason) => reasons.push(reason) }
      )
    ).toEqual([]);

    expect(reasons).toEqual(["invalid_json", "invalid_categories_type"]);
  });

  test("reads raw JSON values and URI-encoded JSON values", () => {
    const categories = JSON.stringify({ categories: ["marketing"] });

    expect(getAcceptedConsentCategoriesFromCookieValue(categories)).toEqual([
      "marketing",
    ]);
    expect(
      getAcceptedConsentCategoriesFromCookieValue(
        encodeURIComponent(categories)
      )
    ).toEqual(["marketing"]);
  });

  test("reports a JSON null value as an unexpected value type", () => {
    const reasons: UnexpectedConsentCookieReason[] = [];

    expect(
      getAcceptedConsentCategoriesFromCookieValue("null", {
        onUnexpectedValue: (reason) => reasons.push(reason),
      })
    ).toEqual([]);
    expect(reasons).toEqual(["invalid_value_type"]);
  });

  test("reports malformed URI encoding as invalid JSON", () => {
    const reasons: UnexpectedConsentCookieReason[] = [];

    expect(
      getAcceptedConsentCategoriesFromCookieValue("%7B%E0%A4%A", {
        onUnexpectedValue: (reason) => reasons.push(reason),
      })
    ).toEqual([]);
    expect(reasons).toEqual(["invalid_json"]);
  });
});

describe("isConsentCategoryAcceptedInCookie", () => {
  const cookieWithCategories = (...categories: readonly string[]) =>
    `cc_cookie=${encodeURIComponent(JSON.stringify({ categories }))}`;

  test("returns false when there is no consent cookie", () => {
    expect(isConsentCategoryAcceptedInCookie("", "analytics")).toBe(false);
  });

  test("checks whether the cookie accepts the requested category", () => {
    const cookie = cookieWithCategories("necessary", "analytics");

    expect(isConsentCategoryAcceptedInCookie(cookie, "analytics")).toBe(true);
    expect(isConsentCategoryAcceptedInCookie(cookie, "marketing")).toBe(false);
  });

  test("returns false for malformed JSON", () => {
    const cookie = `cc_cookie=${encodeURIComponent("{")}`;

    expect(isConsentCategoryAcceptedInCookie(cookie, "analytics")).toBe(false);
  });

  test("requires every copy of the consent cookie to accept the category", () => {
    const cookie = [
      cookieWithCategories("necessary", "analytics"),
      cookieWithCategories("necessary"),
    ].join("; ");

    expect(isConsentCategoryAcceptedInCookie(cookie, "analytics")).toBe(false);
  });
});
