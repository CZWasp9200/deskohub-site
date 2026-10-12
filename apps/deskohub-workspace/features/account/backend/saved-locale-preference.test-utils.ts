import { testEmailAddress } from "@deskohub/test-email";
import { Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { Locale } from "@/features/i18n";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
} from "../customer-account";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import { findSavedLocalePreference } from "./saved-locale-preference";

/** The session cookie of the one synthetic signed-in customer. */
export const syntheticSessionCookie =
  "better-auth.session_token=synthetic-token.signature";

class SyntheticPreferenceReadFailure extends Data.TaggedError(
  "SyntheticPreferenceReadFailure"
) {}

const syntheticAccountId = "synthetic-account" as CustomerAccountId;

/**
 * The saved-preference reader over a fake session read and preference row.
 * The fake session read answers from the request headers the caller
 * provides, as the production read does: only a request carrying
 * `syntheticSessionCookie` is signed in. Tests change the fields of `fake`
 * between requests.
 */
export const makeFakeSavedLocalePreference = () => {
  const fake = {
    savedPreference: undefined as Locale | undefined,
    deletionRequested: false,
    sessionReadFailure: undefined as CustomerAccountAccessError | undefined,
    preferenceReadFailure: false,
    /** The cookie header each session read saw. */
    sessionReads: [] as string[],
    /** The account each preference read asked for. */
    preferenceReads: [] as CustomerAccountId[],
  };

  const authentication = Layer.succeed(
    CustomerAuthentication,
    CustomerAuthentication.of({
      currentUser: Effect.gen(function* () {
        const headers = yield* CurrentWorkspaceRequestHeaders;
        const cookie = headers?.get("cookie") ?? "";
        fake.sessionReads.push(cookie);
        if (fake.sessionReadFailure) return yield* fake.sessionReadFailure;
        if (!cookie.includes(syntheticSessionCookie)) return null;
        return {
          accountId: syntheticAccountId,
          email: testEmailAddress("synthetic-account"),
          deletionRequested: fake.deletionRequested,
        } as CustomerAccountSession;
      }),
    })
  );

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Effect.suspend(() => {
              fake.preferenceReads.push(syntheticAccountId);
              if (fake.preferenceReadFailure) {
                return Effect.fail(new SyntheticPreferenceReadFailure());
              }
              return Effect.succeed(
                fake.savedPreference ? [{ locale: fake.savedPreference }] : []
              );
            }),
        }),
      }),
    }),
  };
  const database = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.of({ db: db as never })
  );

  return {
    fake,
    savedLocalePreference: findSavedLocalePreference.pipe(
      Effect.provide(Layer.mergeAll(authentication, database))
    ),
  };
};
