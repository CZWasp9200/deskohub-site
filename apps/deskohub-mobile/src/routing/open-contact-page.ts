import { apiOrigin } from "../auth/auth-client";
import { openSitePage } from "./open-site-page";
import { type ContactPrefill, contactPageUrl } from "./site-page";

/**
 * Opens the site's contact form in the in-app browser tab, filled in with
 * `prefill`. Where no browser is available there is nothing else to open.
 */
export const openContactPage = (prefill?: ContactPrefill) => {
  void openSitePage(contactPageUrl(apiOrigin, prefill)).catch(() => undefined);
};
