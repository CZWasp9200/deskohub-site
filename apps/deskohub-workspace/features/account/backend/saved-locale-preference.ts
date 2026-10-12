import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerLocalePreferences } from "@/db/schema";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
} from "../customer-account";
import { CustomerAuthentication } from "./customer-authentication.service";

const findLocaleOfAccount = Effect.fn("SavedLocalePreference.findForAccount")(
  function* (accountId: CustomerAccountId) {
    const { db } = yield* WorkspaceDatabase;
    const [row] = yield* db
      .select({ locale: customerLocalePreferences.locale })
      .from(customerLocalePreferences)
      .where(eq(customerLocalePreferences.customerAccountId, accountId))
      .limit(1);
    return row?.locale;
  }
);

/**
 * The saved locale preference of the signed-in customer behind the current
 * request. The account comes from the authoritative Better Auth session
 * read; guests, unverified accounts, and accounts without a saved preference
 * have none. A deletion-pending account keeps its preference until deletion
 * completes. A failed read is logged and resolves to no preference, so the
 * guest locale chain still serves the page.
 */
export const findSavedLocalePreference = Effect.gen(function* () {
  const authentication = yield* CustomerAuthentication;
  const session = yield* authentication.currentUser;
  if (!session) return undefined;
  return yield* findLocaleOfAccount(session.accountId);
}).pipe(
  // Only an unavailable session read is a failure. No live session, an
  // unverified email, or unconfigured authentication means a guest.
  Effect.catchIf(
    (error) =>
      error instanceof CustomerAccountAccessError &&
      error.reason !== "unavailable",
    () => Effect.succeed(undefined)
  ),
  Effect.tapError(() =>
    Effect.logWarning(
      "The saved language preference could not be read; using the guest locale chain.",
      { code: "account.locale-preference.read" }
    )
  ),
  Effect.orElseSucceed(() => undefined),
  Effect.withSpan("SavedLocalePreference.find")
);
