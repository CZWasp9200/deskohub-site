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

/** What the contact form opens filled in with, through its query. */
export interface ContactPrefill {
  readonly name?: string;
  readonly email?: string;
  readonly message?: string;
}

/**
 * The site's contact form, where "Contact us" leads, filled in with
 * `prefill` through the form's `name`, `email` and `message` query.
 */
export const contactPageUrl = (
  siteOrigin: string,
  prefill: ContactPrefill = {}
): string => {
  const url = new URL(sitePageUrl("/contact", siteOrigin));
  for (const key of ["name", "email", "message"] as const) {
    const value = prefill[key];
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url.href;
};
