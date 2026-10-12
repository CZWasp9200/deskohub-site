import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { findSavedLocalePreference } from "./saved-locale-preference";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID().replaceAll("-", "");

describe.skipIf(!testDatabase)(
  "saved locale preference by session on disposable Postgres",
  () => {
    // Read only inside tests: registration runs even when the suite is
    // skipped without a database.
    const dbLayer = () => testDatabase!.layer;

    const insertSession = async (options: {
      readonly locale?: string;
      readonly emailVerified?: boolean;
      readonly expiresIn?: string;
    }) => {
      const accountId = uniqueId();
      const token = uniqueId();
      await testDatabase!.pool.query(
        `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, $3)`,
        [
          accountId,
          `saved-locale-${accountId}@deskohub.test`,
          options.emailVerified ?? true,
        ]
      );
      await testDatabase!.pool.query(
        `insert into auth.session (id, token, user_id, expires_at, updated_at)
         values ($1, $2, $3, now() + $4::interval, now())`,
        [uniqueId(), token, accountId, options.expiresIn ?? "1 day"]
      );
      if (options.locale) {
        await testDatabase!.pool.query(
          `insert into customer_locale_preferences (customer_account_id, locale) values ($1, $2)`,
          [accountId, options.locale]
        );
      }
      return token;
    };

    const find = (token: string) =>
      Effect.runPromise(
        findSavedLocalePreference(token).pipe(Effect.provide(dbLayer()))
      );

    test("reads the saved preference of a live verified session", async () => {
      const token = await insertSession({ locale: "cs-CZ" });

      await expect(find(token)).resolves.toBe("cs-CZ");
    });

    test("has no preference for a legacy account without a saved row", async () => {
      const token = await insertSession({});

      await expect(find(token)).resolves.toBeUndefined();
    });

    test("ignores expired sessions, unverified accounts, and unknown tokens", async () => {
      const expired = await insertSession({
        locale: "cs-CZ",
        expiresIn: "-1 minute",
      });
      const unverified = await insertSession({
        locale: "cs-CZ",
        emailVerified: false,
      });

      await expect(find(expired)).resolves.toBeUndefined();
      await expect(find(unverified)).resolves.toBeUndefined();
      await expect(find(uniqueId())).resolves.toBeUndefined();
    });
  }
);
