import { supportedLocales } from "@deskohub/i18n/locale-registry";

/**
 * Maps an incoming https App Link to the app route Expo Router should open.
 *
 * - The Workspace serves the web app under /app/, and the native app claims
 *   the same /app/ links (a magic link opened from a mail app). Expo Router
 *   applies its `/app` base URL only on web, so on native such a link arrives
 *   as `/app/<route>` and matches no route. It maps to `<route>`, keeping the
 *   query and hash.
 * - The app also claims some website pages (app.config.ts lists them), with or
 *   without a locale tag as the first segment. Each maps to the app screen
 *   showing the same thing, without the query and hash: the access page's
 *   `accessToken` must stay out of the app's route, logs and analytics. A
 *   claimed page whose path the app can't read opens the app's start.
 *
 * Anything else passes through unchanged.
 */
const webBasePath = "/app";

const siteAccountRoutes: Readonly<Record<string, `/${string}`>> = {
  "/account/reservations": "/reservations",
  "/account/referrals": "/account/referrals",
  "/account/profile": "/account/profile",
  "/account/security": "/account/security",
  "/account/assistants": "/account/assistants",
  "/account/billing": "/account/billing",
  "/account/danger": "/account/danger",
};
const siteAccessPath = "/reservation/access/";
const localeTags: ReadonlySet<string> = new Set(supportedLocales);

/** The site path without its locale tag, if it has one. */
const withoutLocale = (pathname: string): string => {
  const [, first = "", ...rest] = pathname.split("/");
  return localeTags.has(first) ? `/${rest.join("/")}` : pathname;
};

const siteRoute = (pathname: string): string | undefined => {
  const path = withoutLocale(pathname);
  const accountRoute = siteAccountRoutes[path];
  if (accountRoute !== undefined) return accountRoute;
  if (!path.startsWith(siteAccessPath)) return undefined;
  const id = path.slice(siteAccessPath.length).replace(/\/$/, "");
  return id === "" || id.includes("/") ? "/" : `/reservations/${id}/access`;
};

export const appLinkRoute = (path: string): string => {
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return path;
  }
  if (url.protocol !== "https:") return path;
  if (
    url.pathname === webBasePath ||
    url.pathname.startsWith(`${webBasePath}/`)
  ) {
    const route = url.pathname.slice(webBasePath.length) || "/";
    return `${route}${url.search}${url.hash}`;
  }
  return siteRoute(url.pathname) ?? path;
};
