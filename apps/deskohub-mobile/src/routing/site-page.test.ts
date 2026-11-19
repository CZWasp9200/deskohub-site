import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { contactPageUrl, sitePageUrl } from "./site-page";

describe("sitePageUrl", () => {
  test("opens the page on the origin the app talks to, without a locale", () => {
    expect(sitePageUrl("/contact", "https://preview.example.test")).toBe(
      "https://preview.example.test/contact"
    );
    expect(contactPageUrl("https://example.test/")).toBe(
      "https://example.test/contact"
    );
  });

  test("prefixes the path with a given locale", () => {
    expect(sitePageUrl("/contact", "https://example.test", "de-DE")).toBe(
      "https://example.test/de-DE/contact"
    );
  });
});

describe("contactPageUrl", () => {
  test("fills the form in through its name, email and message query, leaving out empty fields", () => {
    const url = new URL(
      contactPageUrl("https://example.test", {
        name: "Alex Sample",
        email: testEmailAddress("alex.sample"),
        message: `Line one\nAdd: ${testEmailAddress("a&b")}`,
        ...{ phone: "ignored" },
      })
    );
    expect(url.pathname).toBe("/contact");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: "Alex Sample",
      email: testEmailAddress("alex.sample"),
      message: `Line one\nAdd: ${testEmailAddress("a&b")}`,
    });
    expect(contactPageUrl("https://example.test", { name: "" })).toBe(
      "https://example.test/contact"
    );
  });
});
