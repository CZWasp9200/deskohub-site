import { cookies, headers } from "next/headers";
import { readSavedLocalePreference } from "@/features/account/server/saved-locale-preference.server";
import { continuesInIssuedLocale } from "@/features/checkout/backend/locale-bound-continuation.server";
import { preferenceApplyingTo } from "@/features/checkout/locale-bound-continuation";
import { resolveWorkspaceLocale } from "../locale-resolution";
import type { Locale } from "../paraglide/runtime.js";

const refererUrl = (referer: string | null) => {
  if (!referer) return undefined;
  try {
    return new URL(referer);
  } catch {
    return undefined;
  }
};

/**
 * The locale of a Server Action: the Workspace locale chain applied to the
 * page that invoked it. A page continuing a flow bound to its issued locale
 * keeps that locale, as the proxy keeps it for the page itself.
 */
export async function resolveActionLocale(): Promise<Locale> {
  const [requestHeaders, requestCookies] = await Promise.all([
    headers(),
    cookies(),
  ]);
  const referer = refererUrl(requestHeaders.get("referer"));

  return resolveWorkspaceLocale(
    {
      pathname: referer?.pathname,
      cookies: requestCookies,
      headers: requestHeaders,
    },
    referer
      ? await preferenceApplyingTo(
          referer,
          await readSavedLocalePreference(requestHeaders),
          continuesInIssuedLocale
        )
      : await readSavedLocalePreference(requestHeaders)
  );
}
