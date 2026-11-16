import { describe, expect, test } from "bun:test";
import * as PgClient from "@effect/sql-pg/PgClient";
import { sql } from "drizzle-orm";
import { Cause, Clock, Context, Effect, Exit, Fiber, Option } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { TestClock } from "effect/testing";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { WorkspaceDatabase } from "./database.service";
import { makeDatabaseClient } from "./database-client";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();
const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL ?? "";
const applicationName = "deskohub-statement-timeout-test";

const sqlErrorReason = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? Option.getOrUndefined(
        Option.flatMap(Cause.findErrorOption(exit.cause), (error) => {
          if (SqlError.isSqlError(error)) return Option.some(error.reason);
          const cause = (error as { readonly cause?: unknown }).cause;
          if (!Cause.isCause(cause)) return Option.none();
          return Option.map(
            Option.filter(Cause.findErrorOption(cause), SqlError.isSqlError),
            ({ reason }) => reason
          );
        })
      )
    : undefined;

const activeSleeps = async () =>
  (
    await postgresDatabase!.pool.query(
      `select pid from pg_stat_activity
        where application_name = $1 and state = 'active'
          and query like 'select pg_sleep%'`,
      [applicationName]
    )
  ).rowCount ?? 0;

const openProbe = (settings: {
  readonly statementTimeout?: string;
  readonly connectTimeout?: string;
  readonly maxConnections?: number;
  readonly connectionString?: string;
}) =>
  openDatabasePool({
    connectionString: settings.connectionString ?? databaseUrl,
    maxConnections: settings.maxConnections ?? 2,
    applicationName,
    ...(settings.statementTimeout && {
      statementTimeout: settings.statementTimeout,
    }),
    ...(settings.connectTimeout && { connectTimeout: settings.connectTimeout }),
  });

/** Holds one of the pool's connections for `millis`. */
const holdConnection = (
  pool: Awaited<ReturnType<typeof openProbe>>,
  millis: number
) =>
  Effect.scoped(
    Effect.andThen(
      Context.get(pool.postgres, SqlClient.SqlClient).reserve,
      Effect.sleep(millis)
    )
  );

describe.skipIf(!postgresDatabase)("Database statement timeout", () => {
  test("sends the 10 s statement_timeout as a startup parameter", async () => {
    const pool = await openProbe({});
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const rows = await Effect.runPromise(
        db.execute(sql`select current_setting('statement_timeout') as timeout`)
      );
      expect(rows.rows).toEqual([{ timeout: "10s" }]);
    } finally {
      await pool.close();
    }
  });

  test("fails a statement past the client bound with a retryable StatementTimeoutError and ends it on the server", async () => {
    const pool = await openProbe({ statementTimeout: "300 millis" });
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const started = Date.now();
      const exit = await Effect.runPromiseExit(
        db.execute(sql`select pg_sleep(3)`)
      );
      const elapsed = Date.now() - started;

      const reason = sqlErrorReason(exit);
      expect(reason?._tag).toBe("StatementTimeoutError");
      expect(reason?.isRetryable).toBe(true);
      expect(elapsed).toBeLessThan(1_500);
      expect(await activeSleeps()).toBe(0);
    } finally {
      await pool.close();
    }
  });

  test("bounds Drizzle's row, value and raw reads on the client while the server bound is long", async () => {
    const pool = await openDatabasePool({
      connectionString: databaseUrl,
      maxConnections: 2,
      applicationName,
      statementTimeout: "300 millis",
      startupParameters: { statement_timeout: "30000" },
    });
    try {
      const client = Context.get(pool.postgres, PgClient.PgClient);
      const sleep = () => client.unsafe("select pg_sleep(3)");
      for (const read of [
        sleep().values,
        sleep().withoutTransform,
        sleep().raw,
      ]) {
        const started = Date.now();
        const exit = await Effect.runPromiseExit(read);
        expect(sqlErrorReason(exit)?._tag).toBe("StatementTimeoutError");
        expect(Date.now() - started).toBeLessThan(1_500);
      }
      expect(await activeSleeps()).toBe(0);
    } finally {
      await pool.close();
    }
  });

  test("bounds statements in real time, whatever a test clock reads", async () => {
    const pool = await openProbe({ statementTimeout: "300 millis" });
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const { transaction } = WorkspaceDatabase.make(db);
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const outside = yield* Effect.forkChild(
            db.execute(sql`select pg_sleep(0.1)`)
          );
          const inside = yield* Effect.forkChild(
            transaction(db.execute(sql`select pg_sleep(0.1)`))
          );
          yield* Effect.yieldNow;
          yield* TestClock.adjust("1 hour");
          yield* Fiber.join(outside);
          yield* Fiber.join(inside);
        }).pipe(Effect.provide(TestClock.layer()))
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    } finally {
      await pool.close();
    }
  });

  test("hands a transaction's body, its nested bodies and its afterCommit callbacks the caller's clock", async () => {
    const pool = await openProbe({});
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const { transaction } = WorkspaceDatabase.make(db);
      const seen = await Effect.runPromise(
        Effect.gen(function* () {
          const caller = yield* Clock.clockWith(Effect.succeed);
          let callback: Clock.Clock | undefined;
          const [outer, nested] = yield* transaction(
            Effect.gen(function* () {
              const outer = yield* Clock.clockWith(Effect.succeed);
              const nested = yield* transaction(
                Clock.clockWith(Effect.succeed)
              );
              yield* db.$client.afterCommit(
                Clock.clockWith((clock) =>
                  Effect.sync(() => {
                    callback = clock;
                  })
                )
              );
              return [outer, nested] as const;
            })
          );
          return { caller, outer, nested, callback };
        }).pipe(Effect.provide(TestClock.layer()))
      );
      expect(seen.outer).toBe(seen.caller);
      expect(seen.nested).toBe(seen.caller);
      expect(seen.callback).toBe(seen.caller);
    } finally {
      await pool.close();
    }
  });

  test("bounds each statement on a Workspace transaction's connection", async () => {
    const pool = await openProbe({ statementTimeout: "300 millis" });
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const { transaction } = WorkspaceDatabase.make(db);
      const started = Date.now();
      const exit = await Effect.runPromiseExit(
        transaction(
          db
            .execute(sql`select 1`)
            .pipe(Effect.andThen(db.execute(sql`select pg_sleep(3)`)))
        )
      );

      expect(sqlErrorReason(exit)?._tag).toBe("StatementTimeoutError");
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(await activeSleeps()).toBe(0);
    } finally {
      await pool.close();
    }
  });

  test("starts a statement's clock when it gets a connection, not while it waits for one", async () => {
    const pool = await openProbe({
      statementTimeout: "300 millis",
      maxConnections: 1,
    });
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const holder = yield* Effect.forkChild(holdConnection(pool, 600));
          yield* Effect.sleep("50 millis");
          const rows = yield* db.execute(sql`select 1 as n`);
          yield* Fiber.join(holder);
          return rows;
        })
      );
      expect(result.rows).toEqual([{ n: 1 }]);
    } finally {
      await pool.close();
    }
  });

  test("bounds the wait for a free connection by the connect timeout", async () => {
    const pool = await openProbe({
      connectTimeout: "300 millis",
      maxConnections: 1,
    });
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const holder = yield* Effect.forkChild(holdConnection(pool, 2_000));
          yield* Effect.sleep("50 millis");
          const started = Date.now();
          const waited = yield* Effect.exit(db.execute(sql`select 1`));
          yield* Fiber.interrupt(holder);
          return { waited, elapsed: Date.now() - started };
        })
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(Exit.isFailure(exit.value.waited)).toBe(true);
        expect(exit.value.elapsed).toBeLessThan(1_500);
      }
    } finally {
      await pool.close();
    }
  });

  test("bounds opening a connection by the connect timeout", async () => {
    // A non-routable address: the connection attempt hangs until the bound.
    const pool = await openProbe({
      connectionString:
        "postgres://workspace:workspace@10.255.255.1:5432/workspace",
      connectTimeout: "300 millis",
    });
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      const started = Date.now();
      const exit = await Effect.runPromiseExit(db.execute(sql`select 1`));
      expect(sqlErrorReason(exit)?._tag).toBe("ConnectionError");
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await pool.close();
    }
  });
});
