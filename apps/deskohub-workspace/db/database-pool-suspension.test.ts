import { afterEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { makeDatabaseClient } from "./database-client";
import { attachDatabaseReleaseReporter } from "./database-release-reporter";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();
const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL ?? "";
const applicationName = "deskohub-pool-suspension-test";

const requestContextKey = Symbol.for("@vercel/request-context");
const vercelEnv = ["VERCEL_URL", "VERCEL_REGION"] as const;

/** Stands in for the Vercel runtime's request context and its `waitUntil`. */
const withVercelRequest = () => {
  const waits: Array<Promise<unknown>> = [];
  const saved = vercelEnv.map((name) => [name, process.env[name]] as const);
  process.env.VERCEL_URL = "workspace.example.test";
  process.env.VERCEL_REGION = "fra1";
  Object.assign(globalThis, {
    [requestContextKey]: {
      get: () => ({ waitUntil: (wait: Promise<unknown>) => waits.push(wait) }),
    },
  });
  return {
    waits,
    restore: () => {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      Reflect.deleteProperty(globalThis, requestContextKey);
    },
  };
};

let restoreVercel: (() => void) | undefined;
afterEach(() => {
  restoreVercel?.();
  restoreVercel = undefined;
});

const backendPid = (db: Awaited<ReturnType<typeof clientOver>>["db"]) =>
  Effect.runPromise(
    Effect.map(
      db.execute(sql`select pg_backend_pid()::int as pid`),
      (result) => (result.rows[0] as { readonly pid: number }).pid
    )
  );

const clientOver = async (onRelease?: () => void) => {
  const pool = await openDatabasePool({
    connectionString: databaseUrl,
    maxConnections: 1,
    applicationName,
    onRelease,
  });
  return { pool, db: await Effect.runPromise(makeDatabaseClient(pool)) };
};

describe("Database release reporting to Vercel", () => {
  test("keeps the instance awake past the pools' idle close after each release", async () => {
    const vercel = withVercelRequest();
    restoreVercel = vercel.restore;
    const report = attachDatabaseReleaseReporter(200);

    const started = Date.now();
    report();
    expect(vercel.waits).toHaveLength(1);
    await vercel.waits[0];
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
  });
});

describe.skipIf(!postgresDatabase)(
  "Database pool around function suspension against real Postgres",
  () => {
    test("reports a release each time a statement hands its connection back", async () => {
      let releases = 0;
      const { pool, db } = await clientOver(() => {
        releases += 1;
      });
      try {
        await Effect.runPromise(db.execute(sql`select 1`));
        await Effect.runPromise(db.execute(sql`select 2`));
        expect(releases).toBe(2);
      } finally {
        await pool.close();
      }
    });

    test("closes a released connection after its idle timeout", async () => {
      const pool = await openDatabasePool({
        connectionString: databaseUrl,
        maxConnections: 1,
        applicationName,
        idleTimeout: "200 millis",
      });
      try {
        const db = await Effect.runPromise(makeDatabaseClient(pool));
        const pid = await backendPid(db);
        const deadline = Date.now() + 2_000;
        let alive = true;
        while (alive && Date.now() < deadline) {
          await Bun.sleep(50);
          alive =
            (
              await postgresDatabase!.pool.query(
                "select 1 from pg_stat_activity where pid = $1",
                [pid]
              )
            ).rowCount === 1;
        }
        expect(alive).toBe(false);
      } finally {
        await pool.close();
      }
    });

    test("hands the next caller a fresh connection after the idle one's backend was terminated", async () => {
      const { pool, db } = await clientOver();
      try {
        const terminated = await backendPid(db);
        await postgresDatabase!.pool.query("select pg_terminate_backend($1)", [
          terminated,
        ]);
        // As on a resumed instance: the backend is gone before the next run.
        await Bun.sleep(100);

        const next = await backendPid(db);
        expect(next).not.toBe(terminated);
      } finally {
        await pool.close();
      }
    });
  }
);
