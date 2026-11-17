import { describe, expect, test } from "bun:test";
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
