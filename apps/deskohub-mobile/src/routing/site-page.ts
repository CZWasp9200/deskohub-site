import type { AppLocale } from "../i18n/app-locale";

/**
 * A page of the Workspace site the app talks to, by its path without a
 * locale prefix, so a build pointed at a preview opens that preview's page.
 * Without a locale the site redirects to the reader's language; with one it
 * opens exactly that language's page.
 */
export const sitePageUrl = (
  path: `/${string}`,
  siteOrigin: string,
  locale?: AppLocale
): string =>
  new URL(locale === undefined ? path : `/${locale}${path}`, siteOrigin).href;

/** The site's contact form, where "Contact us" leads. */
export const contactPageUrl = (siteOrigin: string): string =>
  sitePageUrl("/contact", siteOrigin);
