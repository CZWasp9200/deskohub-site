import "server-only";

import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { sessionTokenFromRequestHeaders } from "@/features/account/backend/auth/session-cookie";
import { findSavedLocalePreference } from "@/features/account/backend/saved-locale-preference";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * The signed-in customer's saved language preference for one request.
 * Requests without a session cookie resolve without touching the database.
 * A failed read resolves to no preference, so the guest locale chain still
 * serves the page.
 */
export const readSavedLocalePreference = (
  headers: Pick<Headers, "get">
): Promise<Locale | undefined> => {
  const sessionToken = sessionTokenFromRequestHeaders(headers);
  if (!sessionToken) return Promise.resolve(undefined);

  return findSavedLocalePreference(sessionToken).pipe(
    Effect.provide(WorkspaceDatabase.Default),
    Effect.catch(() =>
      Effect.logWarning(
        "The saved language preference could not be read; using the guest locale chain.",
        { code: "account.locale-preference.read" }
      ).pipe(Effect.as(undefined))
    ),
    runWorkspaceEffect("account.locale-preference.read", { boundary: "route" })
  );
};
