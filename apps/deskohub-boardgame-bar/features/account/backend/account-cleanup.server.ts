import "server-only";

import { lt, sql } from "drizzle-orm";
import { getAccountsDatabase } from "@/db/database.server";
import { authRateLimit, authSession, authVerification } from "@/db/schema";

/** Rate-limit entries older than this no longer limit anything. */
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

export type AccountCleanupRun = {
  readonly sessions: number;
  readonly verifications: number;
  readonly rateLimits: number;
};

/**
 * Deletes sign-in data nobody can use any more: expired sessions (with their
 * IP address and user agent), expired or unused sign-in links, and old
 * rate-limit entries. Better Auth removes an expired session only when its
 * cookie comes back, so without this they would stay forever.
 */
export async function deleteExpiredSignInData(): Promise<
  AccountCleanupRun | undefined
> {
  const database = getAccountsDatabase();
  if (!database) return undefined;

  const sessions = await database
    .delete(authSession)
    .where(lt(authSession.expiresAt, sql`now()`))
    .returning({ id: authSession.id });
  const verifications = await database
    .delete(authVerification)
    .where(lt(authVerification.expiresAt, sql`now()`))
    .returning({ id: authVerification.id });
  const rateLimits = await database
    .delete(authRateLimit)
    .where(lt(authRateLimit.lastRequest, Date.now() - RATE_LIMIT_RETENTION_MS))
    .returning({ id: authRateLimit.id });

  return {
    sessions: sessions.length,
    verifications: verifications.length,
    rateLimits: rateLimits.length,
  };
}
