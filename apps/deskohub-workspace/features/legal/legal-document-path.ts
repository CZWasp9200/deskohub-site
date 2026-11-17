import { parseLocalizedPathname } from "@deskohub/i18n/pathname";
import type { Locale } from "@/features/i18n";
import { getLocalizedPagePath, locales } from "@/features/i18n/routing";

// The proxy imports this module, so it stays clear of the documents and the
// message catalogs.

/** Every published legal document, by the page path it has under each locale. */
export const legalDocumentKeys = [
  "privacy-policy",
  "marketing-communications",
  "terms-and-conditions",
  "cookie-policy",
  "operating-rules",
] as const;

export type LegalDocumentKey = (typeof legalDocumentKeys)[number];

const legalDocumentKeySet: ReadonlySet<string> = new Set(legalDocumentKeys);

export const isLegalDocumentKey = (value: string): value is LegalDocumentKey =>
  legalDocumentKeySet.has(value);

/** The site path of a published legal document in the locale. */
export function getLegalDocumentPath(
  locale: Locale,
  documentKey: LegalDocumentKey
): string {
  return `/${locale}/${documentKey}`;
}

/**
 * The legal document a site pathname shows, such as `/en-US/privacy-policy`
 * or the locale-agnostic `/privacy-policy`, with the locale it names.
 */
export const findLegalDocumentOfPathname = (
  sitePathname: string
):
  | {
      readonly locale: Locale | undefined;
      readonly documentKey: LegalDocumentKey;
    }
  | undefined => {
  const { locale, pathname } = parseLocalizedPathname(sitePathname, locales);
  const documentKey = pathname.slice(1);
  return isLegalDocumentKey(documentKey) ? { locale, documentKey } : undefined;
};

/**
 * Where the proxy serves a legal document the mobile app opened: the same
 * text without the site's header, footer and consent banner.
 */
export const getInAppLegalDocumentPath = (
  locale: Locale,
  documentKey: LegalDocumentKey
) =>
  getLocalizedPagePath(locale, "/[locale]/in-app/[document]", {
    document: documentKey,
  });
