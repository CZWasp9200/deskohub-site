import { getSessionCookie } from "better-auth/cookies";

/**
 * The session token in the request's Better Auth session cookie, or
 * `undefined` when the request carries none. The cookie value is the token
 * followed by its signature; the token alone is the unguessable database key,
 * so an unknown or forged value simply matches no session. Reading it touches
 * no database, so callers can skip session work for guests.
 */
export const sessionTokenFromRequestHeaders = (
  headers: Pick<Headers, "get">
): string | undefined => {
  const cookie = headers.get("cookie");
  if (!cookie) return undefined;
  const value = getSessionCookie(new Headers({ cookie }));
  const token = value?.split(".", 1)[0];
  return token || undefined;
};
