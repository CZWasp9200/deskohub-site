import { setLocaleCookie } from "@deskohub/i18n/next";
import { Effect, Option, Schema } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import type { Locale } from "@/features/i18n";
import { localeCookieName } from "@/features/i18n/routing";
import {
  reservationAccessTokenQueryParam,
  reservationAccessTokenSchema,
  reservationInvitationTokenQueryParam,
  reservationInvitationTokenSchema,
} from "@/features/reservation/reservation-access-token";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { markPrivateResponse } from "@/shared/utils/private-response";
import {
  createReservationAccessCookieCapability,
  parseCanonicalReservationAccessUrl,
  parseCanonicalReservationStatusUrl,
  writeReservationAccessCookie,
} from "./reservation-access-cookie";
import { openReservationAccessToken } from "./reservation-access-token";
import {
  openReservationInvitationToken,
  writeReservationInvitationCookie,
} from "./reservation-invitation-capability";

/**
 * Exchanges the access token in a reservation link for an access cookie, or
 * an invited person's invitation token for an invitation cookie, and
 * redirects to the same page without the token. Rejects malformed, ambiguous,
 * or invalid tokens with a private 404.
 *
 * Callers only invoke this for GET requests to a status or access page that
 * carry the access token query parameter.
 */
export const exchangeReservationCapability = (
  request: NextRequest,
  locale: Locale
): Promise<NextResponse> =>
  exchange(request, locale).pipe(
    runWorkspaceEffect("reservation.access.exchange", { boundary: "route" })
  );

const exchange = (
  request: NextRequest,
  locale: Locale
): Effect.Effect<NextResponse> =>
  request.nextUrl.searchParams.has(reservationInvitationTokenQueryParam)
    ? exchangeInvitation(request, locale)
    : exchangeAccessToken(request, locale);

/**
 * Exchanges an invited person's link for an invitation cookie on the
 * reservation's access page, the only page an invitation opens. A link that
 * also carries an access token is ambiguous and rejected.
 */
const exchangeInvitation = (
  request: NextRequest,
  locale: Locale
): Effect.Effect<NextResponse> => {
  const params = request.nextUrl.searchParams;
  const tokens = params.getAll(reservationInvitationTokenQueryParam);
  if (tokens.length !== 1 || params.has(reservationAccessTokenQueryParam)) {
    return Effect.succeed(reject());
  }
  const token = Option.getOrUndefined(
    Schema.decodeOption(reservationInvitationTokenSchema)(tokens[0] ?? "")
  );
  if (!token) return Effect.succeed(reject());

  const cleanUrl = request.nextUrl.clone();
  cleanUrl.searchParams.delete(reservationInvitationTokenQueryParam);
  const orderId = parseCanonicalReservationAccessUrl(
    `${cleanUrl.pathname}${cleanUrl.search}`,
    locale
  );
  if (!orderId) return Effect.succeed(reject());

  cleanUrl.searchParams.delete("x-vercel-protection-bypass");
  cleanUrl.searchParams.delete("x-vercel-set-bypass-cookie");
  const cleanPath = `${cleanUrl.pathname}${cleanUrl.search}`;

  return Effect.gen(function* () {
    const invitation = yield* openReservationInvitationToken({
      token,
      orderId,
      locale,
    });
    const response = NextResponse.redirect(new URL(cleanPath, request.url));
    yield* writeReservationInvitationCookie(response.cookies, invitation);
    setLocaleCookie(response, localeCookieName, locale);
    return markPrivateResponse(response);
  }).pipe(Effect.catch(() => Effect.succeed(reject())));
};

const exchangeAccessToken = (
  request: NextRequest,
  locale: Locale
): Effect.Effect<NextResponse> => {
  const accessTokens = request.nextUrl.searchParams.getAll(
    reservationAccessTokenQueryParam
  );
  if (accessTokens.length !== 1) return Effect.succeed(reject());
  const accessTokenValue = accessTokens[0];
  if (!accessTokenValue) return Effect.succeed(reject());

  const accessToken = Option.getOrUndefined(
    Schema.decodeOption(reservationAccessTokenSchema)(accessTokenValue)
  );
  if (!accessToken) return Effect.succeed(reject());

  const cleanUrl = request.nextUrl.clone();
  cleanUrl.searchParams.delete(reservationAccessTokenQueryParam);
  const pathWithCapabilityExchangeParams = `${cleanUrl.pathname}${cleanUrl.search}`;
  const orderId =
    parseCanonicalReservationStatusUrl(
      pathWithCapabilityExchangeParams,
      locale
    ) ??
    parseCanonicalReservationAccessUrl(
      pathWithCapabilityExchangeParams,
      locale
    );
  if (!orderId) return Effect.succeed(reject());

  cleanUrl.searchParams.delete("x-vercel-protection-bypass");
  cleanUrl.searchParams.delete("x-vercel-set-bypass-cookie");
  const cleanPath = `${cleanUrl.pathname}${cleanUrl.search}`;

  return Effect.gen(function* () {
    const tokenClaims = yield* openReservationAccessToken({
      token: accessToken,
      orderId,
      locale,
    });
    const response = NextResponse.redirect(new URL(cleanPath, request.url));
    const capability = yield* createReservationAccessCookieCapability({
      orderId,
      locale: tokenClaims.locale,
    });
    yield* writeReservationAccessCookie(response.cookies, {
      orderId,
      capability,
    });
    setLocaleCookie(response, localeCookieName, locale);
    return markPrivateResponse(response);
  }).pipe(Effect.catch(() => Effect.succeed(reject())));
};

const reject = () =>
  markPrivateResponse(new NextResponse(null, { status: 404 }));
