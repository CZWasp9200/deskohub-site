import { and, eq, gt, sql } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerLocalePreferences } from "@/db/schema";
import { authSession, authUser } from "@/db/schema/auth";

/**
 * The saved language preference of the account behind one live,
 * verified-email session, read in a single query. Guests, expired sessions,
 * and legacy accounts without a saved preference have none.
 */
export const findSavedLocalePreference = Effect.fn(
  "SavedLocalePreference.find"
)(function* (sessionToken: string) {
  const { db } = yield* WorkspaceDatabase;
  const [row] = yield* db
    .select({ locale: customerLocalePreferences.locale })
    .from(authSession)
    .innerJoin(authUser, eq(authUser.id, authSession.userId))
    .innerJoin(
      customerLocalePreferences,
      eq(customerLocalePreferences.customerAccountId, authUser.id)
    )
    .where(
      and(
        eq(authSession.token, sessionToken),
        gt(authSession.expiresAt, sql`now()`),
        eq(authUser.emailVerified, true)
      )
    )
    .limit(1);
  return row?.locale;
});
