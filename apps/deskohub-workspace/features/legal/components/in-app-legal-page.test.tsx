import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@/features/i18n";
import { getLegalDocument } from "../content";
import type { LegalDocumentKey } from "../legal-document-path";
import { InAppLegalPage } from "./in-app-legal-page";
import { LegalPage } from "./legal-page";

const variants = {
  page: LegalPage,
  "in-app": InAppLegalPage,
} as const;

const render = (
  variant: keyof typeof variants,
  locale: Locale,
  documentKey: LegalDocumentKey
) => {
  const Page = variants[variant];
  return renderToStaticMarkup(
    <Page locale={locale} documentKey={documentKey} />
  );
};

const textOf = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "gs"))].map(
    ([, inner]) => inner.replace(/<[^>]+>/g, "")
  );

const escapeHtml = (text: string) => renderToStaticMarkup(text);

const legalHrefsOf = (html: string) =>
  [...html.matchAll(/href="(\/[^"]*)"/g)].map(([, href]) =>
    href.replaceAll("&amp;", "&")
  );

describe.each(["page", "in-app"] as const)("the %s variant", (variant) => {
  test.each([
    ["en-US", "privacy-policy"],
    ["cs-CZ", "terms-and-conditions"],
    ["de-DE", "marketing-communications"],
  ] as const)(
    "shows %s %s's title, date, lead and sections in order",
    (locale, documentKey) => {
      const document = getLegalDocument(locale, documentKey);
      const html = render(variant, locale, documentKey);

      expect(textOf(html, "h1")).toEqual([escapeHtml(document.title)]);
      expect(textOf(html, "h2")).toEqual(
        document.sections.map((section) => escapeHtml(section.heading))
      );
      expect(html).toContain(escapeHtml(document.lead));
      expect(html).toContain(escapeHtml(document.updatedAt));
      // Translations carry a notice that the Czech text governs.
      expect(
        document.translationNotice === undefined ||
          html.includes(escapeHtml(document.translationNotice))
      ).toBe(true);
    }
  );
});

describe("the in-app variant", () => {
  test("renders no site header, navigation or footer", () => {
    const html = render("in-app", "en-US", "privacy-policy");

    expect(html).not.toMatch(/<(header|nav|footer)\b/);
    expect(html.match(/<main\b/g)).toHaveLength(1);
  });

  test("links other legal documents in the app's variant", () => {
    const appLinks = legalHrefsOf(
      render("in-app", "en-US", "marketing-communications")
    );
    const siteLinks = legalHrefsOf(
      render("page", "en-US", "marketing-communications")
    );

    expect(siteLinks.length).toBeGreaterThan(0);
    expect(siteLinks.every((href) => !href.includes("native="))).toBe(true);
    expect(appLinks).toEqual(siteLinks.map((href) => `${href}?native=1`));
  });
});
