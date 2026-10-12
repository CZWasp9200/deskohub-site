import "server-only";

import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { findSavedLocalePreference } from "@/features/account/backend/saved-locale-preference";

/**
 * The signed-in customer's saved locale preference, wired to the production
 * session read and database. The session read takes the request headers the
 * caller provides as `CurrentWorkspaceRequestHeaders`.
 */
export const savedLocalePreference = findSavedLocalePreference.pipe(
  Effect.provide(
    Layer.mergeAll(CustomerAuthentication.Default, WorkspaceDatabase.Default)
  )
);
