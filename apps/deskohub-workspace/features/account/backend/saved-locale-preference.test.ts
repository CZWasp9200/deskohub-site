import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Logger } from "effect";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import { CustomerAccountAccessError } from "../customer-account";
import {
  makeFakeSavedLocalePreference,
  syntheticSessionCookie,
} from "./saved-locale-preference.test-utils";

const read = async (
  reader: ReturnType<typeof makeFakeSavedLocalePreference>,
  cookie?: string
) => {
  const warnings: unknown[] = [];
  const captureLogger = Logger.make((options) => {
    if (options.logLevel === "Warn") warnings.push(options.message);
  });
  const preference = await reader.savedLocalePreference.pipe(
    Effect.provideService(
      CurrentWorkspaceRequestHeaders,
      new Headers(cookie ? { cookie } : {})
    ),
    Effect.provide(Logger.layer([captureLogger])),
    Effect.runPromise
  );
  return { preference, warnings };
};

describe("saved locale preference through the session read", () => {
  test("reads the preference of the signed-in account from the request's session", async () => {
    const reader = makeFakeSavedLocalePreference();
    reader.fake.savedPreference = "cs-CZ";

    const { preference, warnings } = await read(reader, syntheticSessionCookie);

    expect(preference).toBe("cs-CZ");
    expect(reader.fake.sessionReads).toEqual([syntheticSessionCookie]);
    expect(reader.fake.preferenceReads).toEqual(["synthetic-account"]);
    expect(warnings).toEqual([]);
  });

  test("keeps the preference of an account pending deletion", async () => {
    const reader = makeFakeSavedLocalePreference();
    reader.fake.savedPreference = "cs-CZ";
    reader.fake.deletionRequested = true;

    expect((await read(reader, syntheticSessionCookie)).preference).toBe(
      "cs-CZ"
    );
  });

  test("has no preference for a guest and never reads the preference table", async () => {
    const reader = makeFakeSavedLocalePreference();
    reader.fake.savedPreference = "cs-CZ";

    const { preference, warnings } = await read(reader);

    expect(preference).toBeUndefined();
    expect(reader.fake.preferenceReads).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("has no preference for an account without a saved row", async () => {
    const reader = makeFakeSavedLocalePreference();

    expect(
      (await read(reader, syntheticSessionCookie)).preference
    ).toBeUndefined();
  });

  test.each(["unauthenticated", "unverified-email", "not-configured"] as const)(
    "treats a %s session read as a guest without a warning",
    async (reason) => {
      const reader = makeFakeSavedLocalePreference();
      reader.fake.savedPreference = "cs-CZ";
      reader.fake.sessionReadFailure = new CustomerAccountAccessError({
        reason,
      });

      const { preference, warnings } = await read(
        reader,
        syntheticSessionCookie
      );

      expect(preference).toBeUndefined();
      expect(reader.fake.preferenceReads).toEqual([]);
      expect(warnings).toEqual([]);
    }
  );

  test("falls back to no preference with one warning when the session read is unavailable", async () => {
    const reader = makeFakeSavedLocalePreference();
    reader.fake.savedPreference = "cs-CZ";
    reader.fake.sessionReadFailure = new CustomerAccountAccessError({
      reason: "unavailable",
    });

    const { preference, warnings } = await read(reader, syntheticSessionCookie);

    expect(preference).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  test("falls back to no preference with one warning when the preference read fails", async () => {
    const reader = makeFakeSavedLocalePreference();
    reader.fake.preferenceReadFailure = true;

    const { preference, warnings } = await read(reader, syntheticSessionCookie);

    expect(preference).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
