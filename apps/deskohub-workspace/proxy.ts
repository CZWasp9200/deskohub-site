import {
  getLocaleFromRequestPathname,
  getLocalizedRedirectPathname,
  resolveRequestLocale,
  setLocaleCookie,
} from "@deskohub/i18n/next";
import { Result } from "effect";
import {
  type MiddlewareConfig,
  type NextRequest,
  NextResponse,
} from "next/server";
import {
  localeConfig,
  localeCookieName,
  locales,
} from "@/features/i18n/routing";
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

  if (localeFromUrl) {
    if (hasReservationCapabilityToExchange(request)) {
      const { exchangeReservationCapability } = await import(
        "./features/reservation/backend/reservation-capability-exchange"
      );
      return exchangeReservationCapability(request, localeFromUrl);
    }

    const response = NextResponse.next();
    if (
      isPrivateReservationPath(request.nextUrl.pathname) ||
      isPrivateAccountPath(request.nextUrl.pathname)
    ) {
      markPrivateResponse(response);
    }
    setLocaleCookie(response, localeCookieName, localeFromUrl);
    return response;
  }

  const resolvedLocale = resolveRequestLocale({
    request,
    localeConfig: localeConfig,
    localeCookieName: localeCookieName,
  });

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = getLocalizedRedirectPathname(
    request.nextUrl.pathname,
    resolvedLocale,
    locales
  );

  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("Vary", "Accept-Language");
  if (isPrivateReservationPath(request.nextUrl.pathname)) {
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
