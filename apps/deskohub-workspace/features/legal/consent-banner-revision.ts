import { createHash } from "node:crypto";
import { type Locale, locales } from "@/features/i18n";
import type { LegalDocumentKey } from "./legal-document-summaries";

/** The documents a cookie consent choice is made under. */
const consentBannerDocuments = [
  "privacy-policy",
  "cookie-policy",
] as const satisfies readonly LegalDocumentKey[];

type ConsentBannerDocument = (typeof consentBannerDocuments)[number];

/**
 * The published version (`getLegalDocumentVersion`) of each document the
 * banner is bound to, per locale whose legal documents are published. A copy,
 * so the server's consent cookie readers, which every request loads, never
 * load the legal texts or React; a test fails with the current versions
 * whenever either document changes in any locale.
 *
 * Recording a new locale's versions here changes the banner revision, which
 * reopens the cookie banner for every visitor.
 */
export const consentBannerDocumentVersions: Readonly<
  Partial<Record<Locale, Readonly<Record<ConsentBannerDocument, string>>>>
> = {
  "en-US": {
    "privacy-policy":
      "7b339938e2868abeea712d671e613cfbcf2001ab9201e1dffb93eaf4057f6cdc",
    "cookie-policy":
      "476c15e027bde0e04823024f02842b5652456a9721680f0efd0dabf9d494fd03",
  },
  "cs-CZ": {
    "privacy-policy":
      "a446f7a772884a6d288700ae7287470360df7271a4c6ecc00b0d2395158268fc",
    "cookie-policy":
      "9e1622d98ffc2f8879400494842ee8e2ee3f096a5e023636388c65c220dc3801",
  },
  "de-DE": {
    "privacy-policy":
      "8fedd49f42cc022e7bf4317508d776a2043f6619834ebff905dd95d0770da463",
    "cookie-policy":
      "6812034325d23d8f848a4fb64f09d8aa014d62cc7d3addc45759c1fb075fc486",
  },
  "uk-UA": {
    "privacy-policy":
      "89f47c0619e1c209a05240b14b89100b540f041913f8918c2dd5c353741d168c",
    "cookie-policy":
      "08480393eeeadb3cbc83b2cdd9be368d03eb1f96a2156c4d5cf064ee7c656d00",
  },
  "sk-SK": {
    "privacy-policy":
      "d873f58604993617ca23cd843d95aa573187d8dcbd03192c088e5a5723aa297b",
    "cookie-policy":
      "d9cc345892616de3c3b05e7e1f7e505a7947738423b2ee4276d0757f3d4dbfaf",
  },
  "vi-VN": {
    "privacy-policy":
      "1f5b58cfd318791b24a8c36517ec04bee3a09141bf5f433844860c403437b204",
    "cookie-policy":
      "d1a469bc79c9be640a99e42a1266b825ad10e543c7895526567d9207c4f2dd92",
  },
  "hi-IN": {
    "privacy-policy":
      "404eeaedb1e762bf12af9dd6c03925b499c3493953a9026f4f9384300fb7d2cc",
    "cookie-policy":
      "8a1b1ac6543ec1b2a5d9ab7188e86679699a29fe1910e762bfa8a1a151ed6bad",
  },
};

const publishedVersionOf = (
  locale: Locale,
  documentKey: ConsentBannerDocument
): string | undefined => consentBannerDocumentVersions[locale]?.[documentKey];

/**
 * The cookie banner revision of the privacy notice and cookie policy in every
 * locale: a positive safe integer that changes whenever either document
 * changes in any locale, which invalidates every saved consent choice and
 * reopens the banner. Switching the site language never changes it. Never 0,
 * the revision every consent cookie saved before the banner was bound to the
 * documents carries. `versionOf` defaults to the published versions.
 */
export function getConsentBannerRevision(
  versionOf: (
    locale: Locale,
    documentKey: ConsentBannerDocument
  ) => string | undefined = publishedVersionOf
): number {
  // Only locales with recorded versions count, in registry order.
  const versions = locales.flatMap((locale) =>
    consentBannerDocuments.flatMap((documentKey) => {
      const version = versionOf(locale, documentKey);
      return version === undefined ? [] : [version];
    })
  );
  const digest = createHash("sha256").update(versions.join("\n")).digest("hex");
  // 48 bits stay well inside Number.MAX_SAFE_INTEGER.
  return Number.parseInt(digest.slice(0, 12), 16) || 1;
}
