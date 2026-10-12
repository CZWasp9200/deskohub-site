import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { customerLocalePreferences } from "./customer-locale-preferences";

const MIGRATION_DIR = "20261012213118_customer_locale_preferences";
const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url)
);

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

/**
 * Links every migration that precedes the preference migration into a
 * scratch folder, so a database can be brought to the pre-migration state
 * that production customers are in.
 */
const linkMigrationsBefore = async (migration: string) => {
  const folder = await mkdtemp(join(tmpdir(), "workspace-migrations-"));
  const names = await readdir(migrationsFolder);
  for (const name of names.filter((entry) => entry < migration)) {
    await symlink(join(migrationsFolder, name), join(folder, name));
  }
  return folder;
};

/**
 * Creates a disposable sibling database next to the configured test
 * database, runs the callback against it, and always drops it.
 */
const withScratchDatabase = async (
  databaseUrl: string,
  run: (pool: Pool) => Promise<void>
) => {
  const name = `ccp_legacy_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create database "${name}"`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  try {
    await run(pool);
  } finally {
    await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
};

describe("customer locale preferences", () => {
  test("shapes the preference table", () => {
    const config = getTableConfig(customerLocalePreferences);
    expect(config.name).toBe("customer_locale_preferences");
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column])
    );
    expect(columns.customer_account_id?.primary).toBe(true);
    expect(columns.locale?.notNull).toBe(true);
    expect(config.checks.length).toBe(1);
    expect(new PgDialect().sqlToQuery(config.checks[0]!.value).sql).toContain(
      "'en-US'"
    );
  });

  test.skipIf(!testDatabaseUrl)(
    "leaves accounts that existed before the migration without a preference",
    async () => {
      const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
      try {
        await withScratchDatabase(testDatabaseUrl!, async (pool) => {
          await migrate(drizzle({ client: pool }), {
            migrationsFolder: earlierMigrations,
          });
          const legacyAccountIds = [crypto.randomUUID(), crypto.randomUUID()];
          for (const id of legacyAccountIds) {
            await pool.query(
              `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, true)`,
              [id, testEmailAddress(`legacy-${id}`)]
            );
          }

          await migrate(drizzle({ client: pool }), { migrationsFolder });

          const preferences = await pool.query(
            `select customer_account_id from customer_locale_preferences`
          );
          expect(preferences.rows).toEqual([]);
          const users = await pool.query(
            `select id from auth."user" where id = any($1)`,
            [legacyAccountIds]
          );
          expect(users.rows).toHaveLength(2);
        });
      } finally {
        await rm(earlierMigrations, { recursive: true, force: true });
      }
    },
    { timeout: 60000 }
  );
});
