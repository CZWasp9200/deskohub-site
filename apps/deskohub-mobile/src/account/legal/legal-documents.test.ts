import { describe, expect, test } from "bun:test";
import { legalDocuments, legalDocumentUrl } from "./legal-documents";

describe("legalDocumentUrl", () => {
  test("links every document on the configured origin without a locale, as opened from the app", () => {
    const urls = legalDocuments.map((document) =>
      legalDocumentUrl(document, "https://workspace.deskohub.cz")
    );

    expect(urls).toEqual([
      "https://workspace.deskohub.cz/privacy-policy?native=1",
      "https://workspace.deskohub.cz/marketing-communications?native=1",
      "https://workspace.deskohub.cz/terms-and-conditions?native=1",
      "https://workspace.deskohub.cz/cookie-policy?native=1",
    ]);
  });

  test("follows a preview or local origin", () => {
    expect(
      legalDocumentUrl(
        "privacy",
        "https://deskohub-workspace-git-branch.vercel.app"
      )
    ).toBe(
      "https://deskohub-workspace-git-branch.vercel.app/privacy-policy?native=1"
    );
    expect(legalDocumentUrl("terms", "http://10.0.2.2:3000")).toBe(
      "http://10.0.2.2:3000/terms-and-conditions?native=1"
    );
  });

  test("with a locale, opens exactly that language's document, as the site's /<locale>/<document> path", () => {
    expect(
      legalDocumentUrl("marketing", "https://workspace.deskohub.cz", "de-DE")
    ).toBe(
      "https://workspace.deskohub.cz/de-DE/marketing-communications?native=1"
    );
  });
});
