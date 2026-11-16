/**
 * A page of the Workspace site the app talks to, by its path without a
 * locale prefix: the site redirects it to the reader's language, and a build
 * pointed at a preview opens that preview's page.
 */
export const sitePageUrl = (path: `/${string}`, siteOrigin: string): string =>
  new URL(path, siteOrigin).href;

/** The site's contact form, where "Contact us" leads. */
export const contactPageUrl = (siteOrigin: string): string =>
  sitePageUrl("/contact", siteOrigin);
