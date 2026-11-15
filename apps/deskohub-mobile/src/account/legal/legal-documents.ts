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
 * The locale-agnostic URL of a legal document on the Workspace the app talks
 * to, so a build pointed at a preview opens that preview's documents.
 * `native=1` tells the site the app opened it, so the page leaves out the
 * site's header, footer and consent banner.
 */
export const legalDocumentUrl = (
  document: LegalDocument,
  siteOrigin: string
): string => {
  const url = new URL(legalDocumentPath[document], siteOrigin);
  url.searchParams.set("native", "1");
  return url.href;
};
