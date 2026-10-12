import { cookies, headers } from "next/headers";
import { readSavedLocalePreference } from "@/features/account/server/saved-locale-preference.server";
import { resolveWorkspaceLocale } from "../locale-resolution";
import type { Locale } from "../paraglide/runtime.js";

const refererPathname = (referer: string | null) => {
  if (!referer) return undefined;
  try {
    return new URL(referer).pathname;
  } catch {
    return undefined;
  }
};

/**
 * The locale of a Server Action: the Workspace locale chain applied to the
 * page that invoked it.
 */
export async function resolveActionLocale(): Promise<Locale> {
  const [requestHeaders, requestCookies] = await Promise.all([
    headers(),
    cookies(),
  ]);

  return resolveWorkspaceLocale(
    {
      pathname: refererPathname(requestHeaders.get("referer")),
      cookies: requestCookies,
      headers: requestHeaders,
    },
    await readSavedLocalePreference(requestHeaders)
  );
}
