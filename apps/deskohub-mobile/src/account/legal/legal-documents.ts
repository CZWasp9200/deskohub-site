import type { AppLocale } from "../../i18n/app-locale";

/** The site's legal documents the Legal & Privacy screen links to, in order. */
export const legalDocuments = [
  "privacy",
  "marketing",
  "terms",
  "cookies",
] as const;
export type LegalDocument = (typeof legalDocuments)[number];

// The site's page paths without a locale prefix: the site redirects each to
// the reader's language.
const legalDocumentPath: Record<LegalDocument, string> = {
  privacy: "/privacy-policy",
  marketing: "/marketing-communications",
  terms: "/terms-and-conditions",
  cookies: "/cookie-policy",
};

/**
 * The URL of a legal document on the Workspace the app talks to, so a build
 * pointed at a preview opens that preview's documents. Without a locale the
 * site picks the reader's language; with one it opens exactly that
 * language's document, such as the version a consent is recorded against.
 */
export const legalDocumentUrl = (
  document: LegalDocument,
  siteOrigin: string,
  locale?: AppLocale
): string =>
  new URL(
    locale === undefined
      ? legalDocumentPath[document]
      : `/${locale}${legalDocumentPath[document]}`,
    siteOrigin
  ).href;
