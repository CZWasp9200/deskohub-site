import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { locales } from "@/features/i18n";
import { isOpenedFromApp } from "@/shared/utils/opened-from-app";
import { getCanonicalLegalDocument } from "./canonical-document";
import { getLegalDocument } from "./content";
import { keepLegalLinksInApp } from "./in-app-legal-links";
import {
  findLegalDocumentOfPathname,
  legalDocumentKeys,
} from "./legal-document-path";

const hrefsOf = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) =>
    href.replaceAll("&amp;", "&")
  );

// Renders nodes as static children, which React checks for no keys.
const renderNodes = (nodes: readonly ReactNode[]) =>
  renderToStaticMarkup(createElement(Fragment, null, ...nodes));

const render = (node: ReactNode) => renderNodes([keepLegalLinksInApp(node)]);

describe("keepLegalLinksInApp", () => {
  const mailto = `mailto:${testEmailAddress("legal-links")}`;

  test("keeps links to legal documents in the app's variant, at any depth", () => {
    const html = render(
      <>
        Read the <a href="/en-US/privacy-policy">policy</a>,{" "}
        <strong>
          the <a href="/terms-and-conditions#payments">terms</a>
        </strong>{" "}
        and <a href="/cs-CZ/cookie-policy?section=2">cookies</a>.
      </>
    );

    expect(hrefsOf(html)).toEqual([
      "/en-US/privacy-policy?native=1",
      "/terms-and-conditions?native=1#payments",
      "/cs-CZ/cookie-policy?section=2&native=1",
    ]);
  });

  test.each([
    mailto,
    "https://uoou.gov.cz/en",
    "//evil.example/en-US/privacy-policy",
    "/en-US/faq",
    "/official-company-extract.pdf",
    "/en-US/privacy-policy/extra",
  ])("leaves %p as authored", (href) => {
    expect(hrefsOf(render(<a href={href}>Contact us</a>))).toEqual([href]);
  });

  test("renders text and other links unchanged", () => {
    const node = (
      <>
        Plain text{" "}
        <span>
          with <em>emphasis</em> and an <a href="#rights">anchor</a>
        </span>
        {null}
      </>
    );

    expect(render(node)).toBe(renderNodes([node]));
  });

  test("keeps every published document's text and version, linking its legal references in the app", () => {
    for (const locale of locales) {
      for (const documentKey of legalDocumentKeys) {
        const document = getLegalDocument(locale, documentKey);
        const inApp = {
          ...document,
          sections: document.sections.map((section) => ({
            ...section,
            body: section.body.map(keepLegalLinksInApp),
          })),
        };

        expect(getCanonicalLegalDocument(inApp)).toBe(
          getCanonicalLegalDocument(document)
        );
        for (const href of hrefsOf(
          renderNodes(inApp.sections.flatMap((section) => section.body))
        )) {
          const url = new URL(href, "https://workspace.invalid");
          const isLegal =
            href.startsWith("/") &&
            findLegalDocumentOfPathname(url.pathname) !== undefined;
          expect(isOpenedFromApp(url.searchParams)).toBe(isLegal);
        }
      }
    }
  });
});
