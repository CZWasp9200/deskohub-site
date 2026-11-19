import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";
import { makeDatabaseClient } from "./database-client";
import { normalizePostgresConnectionUrl } from "./postgres-connection-url";

const sslModeOf = (url: string) =>
  new URL(normalizePostgresConnectionUrl(url)).searchParams.get("sslmode");

describe("normalizePostgresConnectionUrl", () => {
  test.each(["require", "prefer", "verify-ca"])(
    "verifies the server for sslmode=%s",
    (mode) => {
      expect(
        sslModeOf(`postgres://u:p@db.example.test/app?sslmode=${mode}`)
      ).toBe("verify-full");
    }
  );

  test.each(["disable", "verify-full"])("keeps sslmode=%s", (mode) => {
    expect(
      sslModeOf(`postgres://u:p@db.example.test/app?sslmode=${mode}`)
    ).toBe(mode);
  });

  test("leaves a URL without sslmode alone", () => {
    expect(sslModeOf("postgres://u:p@db.example.test/app")).toBeNull();
  });
});

const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("The native pool's TLS mode", () => {
  // The disposable test server speaks no TLS, so a pool that requires it
  // must refuse to connect rather than fall back to plain text.
  test("refuses a server without TLS for sslmode=require", async () => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("sslmode", "require");
    const pool = await openDatabasePool({
      connectionString: url.toString(),
      maxConnections: 1,
    });
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const exit = await Effect.runPromiseExit(db.execute(sql`select 1`));
      expect(Exit.isFailure(exit)).toBe(true);
    } finally {
      await pool.close();
    }
  });
});
