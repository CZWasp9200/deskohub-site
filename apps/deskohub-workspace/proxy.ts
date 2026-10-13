import {
  getLocaleFromRequestPathname,
  getLocalizedRedirectPathname,
  setLocaleCookie,
} from "@deskohub/i18n/next";
import { getSessionCookie } from "better-auth/cookies";
import { Result } from "effect";
import {
  type MiddlewareConfig,
  type NextRequest,
  NextResponse,
} from "next/server";
import { resolveWorkspaceLocale } from "@/features/i18n/locale-resolution";
import { localeCookieName, locales } from "@/features/i18n/routing";
import { env } from "./env";
import { appendVercelPreviewProtectionBypass } from "./features/checkout/backend/checkout/vercel-preview-protection-bypass";
import { reservationAccessTokenQueryParam } from "./features/reservation/reservation-access-token";
import { isAdministratorAuthorizationValid } from "./shared/administrator/administrator-basic-auth";
import { resolveWorkspaceRuntimeCallbackOrigin } from "./shared/backend/config/workspace-url.config";
import { markPrivateResponse } from "./shared/utils/private-response";

const isAdministrationPath = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

const isPrivateReservationPath = (pathname: string) =>
  pathname.includes("/reservation/status/") ||
  pathname.includes("/reservation/access/") ||
  pathname.includes("/reservation/invoice/");

const isReservationCapabilityExchangePath = (pathname: string) =>
  pathname.includes("/reservation/status/") ||
  pathname.includes("/reservation/access/");

// Only these requests carry a reservation access token to exchange, so the
// exchange module and its Effect runtime load for them alone.
const hasReservationCapabilityToExchange = (request: NextRequest) =>
  request.method === "GET" &&
  isReservationCapabilityExchangePath(request.nextUrl.pathname) &&
  request.nextUrl.searchParams.has(reservationAccessTokenQueryParam);

const isPrivateAccountPath = (pathname: string) =>
  /\/account(\/|$)/.test(pathname) || /\/auth(\/|$)/.test(pathname);

// Only page requests from a browser holding a session cookie can carry a saved
// locale preference, so guests and router prefetches never load the reader or
// touch the database. Prefetched links already share the page's locale. The
// cookie check is Better Auth's optimistic presence test; the reader then
// validates the session through Better Auth. A reader that fails to load
// counts as no preference, like a failed read.
//
// Accepted side effect: for a correctly signed cookie of an expired or revoked
// session, Better Auth's `getSession` deletes the expired session row and
// expires the cookie through `nextCookies`. Next then replaces this response's
// Set-Cookie with that expiry, so the locale cookie is not refreshed on this
// one response; the URL still carries the locale, and the next (guest) request
// sets the cookie again.
const pageLocalePreference = async (request: NextRequest) => {
  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    request.headers.has("next-router-prefetch") ||
    !getSessionCookie(request)
  ) {
    return undefined;
  }

  try {
    const { readPageLocalePreference } = await import(
      "./features/i18n/server/page-locale-preference.server"
    );
    return await readPageLocalePreference(request.headers, request.nextUrl);
  } catch {
    return undefined;
  }
};

export async function proxy(request: NextRequest) {
  if (isAdministrationPath(request.nextUrl.pathname)) {
    if (
      !isAdministratorAuthorizationValid(
        request.headers.get("authorization"),
        env.ADMIN_BASIC_AUTH_CREDENTIALS
      )
    ) {
      return new NextResponse(null, {
        status: 401,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Authorization",
          "WWW-Authenticate":
            'Basic realm="Deskohub administration", charset="UTF-8"',
        },
      });
    }

    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Authorization");
    return response;
  }

  if (request.method === "POST" && request.headers.has("next-action")) {
    return NextResponse.next();
  }

  if (
    env.VERCEL_ENV === "preview" &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const callbackOrigin = Result.getOrThrow(
      resolveWorkspaceRuntimeCallbackOrigin()
    );
    if (request.nextUrl.origin !== callbackOrigin.origin) {
      const redirectUrl = new URL(
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
        callbackOrigin
      );
      appendVercelPreviewProtectionBypass(redirectUrl, {
        setBypassCookie: true,
      });
      return markPrivateResponse(NextResponse.redirect(redirectUrl));
    }
  }

  const localeFromUrl = getLocaleFromRequestPathname(request, locales);

  // A reservation capability is bound to the locale it was issued in, so it is
  // exchanged before any preference redirect moves the request elsewhere.
  if (localeFromUrl && hasReservationCapabilityToExchange(request)) {
    const { exchangeReservationCapability } = await import(
      "./features/reservation/backend/reservation-capability-exchange"
    );
    return exchangeReservationCapability(request, localeFromUrl);
  }

  // A verified continuation (a Pay state or an invoice link) keeps the locale
  // it was issued in; the saved preference applies everywhere else.
  const savedPreference = await pageLocalePreference(request);
  const resolvedLocale = resolveWorkspaceLocale(
    {
      pathname: request.nextUrl.pathname,
      cookies: request.cookies,
      headers: request.headers,
    },
    savedPreference
  );

  if (localeFromUrl === resolvedLocale) {
    const response = NextResponse.next();
    if (
      isPrivateReservationPath(request.nextUrl.pathname) ||
      isPrivateAccountPath(request.nextUrl.pathname)
    ) {
      markPrivateResponse(response);
    }
    setLocaleCookie(response, localeCookieName, resolvedLocale);
    return response;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = getLocalizedRedirectPathname(
    request.nextUrl.pathname,
    resolvedLocale,
    locales
  );

  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("Vary", "Accept-Language");
  if (
    savedPreference !== undefined ||
    isPrivateReservationPath(request.nextUrl.pathname)
  ) {
    markPrivateResponse(response);
  }
  setLocaleCookie(response, localeCookieName, resolvedLocale);
  return response;
}

export const config: MiddlewareConfig = {
  matcher: [
    "/admin/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|.*\\..*).*)",
  ],
};
