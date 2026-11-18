import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  Cause,
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
} from "effect";
import { SqlClient, type SqlConnection } from "effect/sql";
import type { Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type DatabasePool,
  makeDatabaseClient,
  makeDatabasePool,
  type RootDatabaseClient,
} from "@/db/database-client";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";
import { createScratchPostgresDatabase } from "./postgres-scratch-database.test-utils";
import { fixtureReservationAuthorId } from "./workspace-fixtures.test-utils";

const testStatementTimeoutMillis = 30_000;

export interface WorkspacePostgresTestDatabase {
  /** Over `databasePool`, as production's client is over its native pool. */
  readonly db: RootDatabaseClient;
  readonly layer: Layer.Layer<WorkspaceDatabase>;
  /** The native pool the Workspace client runs on. */
  readonly databasePool: DatabasePool;
  /** A node-postgres pool for the test's own raw setup and assertions. */
  readonly pool: Pool;
  readonly close: () => Promise<void>;
}

let connection: Promise<WorkspacePostgresTestDatabase | null> | undefined;

const connectWorkspacePostgres = async (
  databaseUrl: string
): Promise<WorkspacePostgresTestDatabase> => {
  // The tests' own raw setup and assertions, such as one statement inserting
  // tens of thousands of rows, get test-environment bounds; the Workspace
  // client below keeps production's.
  const pool = makeDatabasePool({
    connectionString: databaseUrl,
    ...databasePoolTimeouts,
    query_timeout: testStatementTimeoutMillis,
    statement_timeout: testStatementTimeoutMillis,
  });

  const failClosed = async (step: string, cause: unknown): Promise<never> => {
    await pool.end().catch(() => {});
    throw new Error(
      `WORKSPACE_TEST_DATABASE_URL is configured but the disposable Postgres test database ${step}.`,
      { cause }
    );
  };

  try {
    await pool.query("select 1");
  } catch (cause) {
    return failClosed("is unreachable", cause);
  }

  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: fileURLToPath(
        new URL("../../db/migrations", import.meta.url)
      ),
    });
  } catch (cause) {
    return failClosed("migration failed", cause);
  }

  await pool.query(
    "insert into customer_accounts (id) values ($1) on conflict do nothing",
    [fixtureReservationAuthorId]
  );

  const databasePool = await openDatabasePool({
    connectionString: databaseUrl,
    maxConnections: 10,
  });
  const db = await Effect.runPromise(makeDatabaseClient(databasePool));

  return {
    db,
    layer: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db)),
    databasePool,
    pool,
    close: async () => {
      try {
        await databasePool.close();
      } finally {
        await pool.end();
      }
    },
  };
};

const connectConfiguredWorkspacePostgres = async () => {
  const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;
  return databaseUrl ? connectWorkspacePostgres(databaseUrl) : null;
};

/**
 * The configured test database, migrated once and shared by every suite
 * without a database of its own.
 */
export const connectWorkspacePostgresTestDatabase =
  (): Promise<WorkspacePostgresTestDatabase | null> =>
    (connection ??= connectConfiguredWorkspacePostgres());

/**
 * A test database no other suite uses. Helpers whose subject reads or writes
 * every row of a table, such as the automation engine planning every active
 * automation over every active consent, require one.
 */
export interface WorkspacePostgresSuiteDatabase
  extends WorkspacePostgresTestDatabase {
  readonly owner: "suite";
}

/**
 * A migrated database of the suite's own, beside the configured test
 * database: other suites' rows never reach it, nor its rows theirs. Close it
 * in a file-level `afterAll`; `close` drops it.
 */
export const createWorkspacePostgresSuiteDatabase = async (
  namePrefix: string
): Promise<WorkspacePostgresSuiteDatabase | null> => {
  const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;
  if (!databaseUrl) return null;
  const scratch = await createScratchPostgresDatabase(databaseUrl, namePrefix);
  try {
    const database = await connectWorkspacePostgres(scratch.url);
    return {
      ...database,
      owner: "suite",
      close: async () => {
        try {
          await database.close();
        } finally {
          await scratch.drop();
        }
      },
    };
  } catch (cause) {
    await scratch.drop();
    throw cause;
  }
};

/**
 * The same database over a native pool of its own whose statements the
 * server cancels after `statementTimeoutMillis` (SQLSTATE 57014), as a
 * server-side statement timeout does. The client keeps its default bound,
 * which is longer, so the server's cancellation is the one that ends a
 * waiting statement. `pool` stays the original one, so setup and checks
 * never time out. Close it before the database; `close` ends only the new
 * pool.
 */
export const withStatementTimeout = async <
  Database extends WorkspacePostgresTestDatabase,
>(
  database: Database,
  statementTimeoutMillis: number
): Promise<Database> => {
  const { connectionString } = database.pool.options;
  if (!connectionString) {
    throw new Error("The test database pool has no connection string.");
  }
  const databasePool = await openDatabasePool({
    connectionString,
    maxConnections: 4,
    startupParameters: { statement_timeout: String(statementTimeoutMillis) },
  });
  const db = await Effect.runPromise(makeDatabaseClient(databasePool));
  return {
    ...database,
    db,
    layer: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db)),
    databasePool,
    close: () => databasePool.close(),
  };
};

/**
 * A transaction on one connection of the database's native pool, held open
 * by the test, which ends it through `query`. Effect SQL opens it, so the
 * client's own transactions inside become savepoints of it; the test's
 * `begin` is therefore a no-op, and its `commit` or `rollback` ends the held
 * transaction. Other statements run on the transaction's connection, and
 * `query` answers as node-postgres does (`rows`, `rowCount`), with the native
 * driver's values.
 */
export interface HeldDatabaseConnection {
  readonly pool: DatabasePool;
  /** The held transaction's level, which `withHeldTransaction` joins. */
  readonly context: Context.Context<never>;
  readonly query: <Row>(
    sql: string,
    params?: ReadonlyArray<unknown>
  ) => Promise<{ readonly rows: Row[]; readonly rowCount: number | null }>;
  /** Rolls the transaction back if the test has not ended it. */
  readonly release: () => Promise<void>;
}

type NativeResult = {
  readonly rows: ReadonlyArray<unknown>;
  readonly rowCount: number | null;
};

class HeldRollback extends Data.TaggedError("HeldRollback") {}

export const holdDatabaseConnection = async (database: {
  readonly databasePool: DatabasePool;
}): Promise<HeldDatabaseConnection> => {
  const pool = database.databasePool;
  const client = Context.get(pool.postgres, SqlClient.SqlClient);
  const opened = Effect.runSync(
    Deferred.make<{
      readonly connection: SqlConnection.Connection;
      readonly context: Context.Context<never>;
    }>()
  );
  const ending = Effect.runSync(Deferred.make<"commit" | "rollback">());
  const held = Effect.runFork(
    // biome-ignore lint/plugin: the held transaction is the raw client's own, so Workspace transactions inside it become its savepoints.
    client.withTransaction(
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        // Effect SQL provides its level to the transaction body.
        const level = yield* Effect.serviceOption(client.transactionService);
        if (Option.isNone(level)) {
          return yield* Effect.die(new Error("No transaction level"));
        }
        const [connection] = level.value;
        yield* Deferred.succeed(opened, { connection, context });
        if ((yield* Deferred.await(ending)) === "rollback") {
          return yield* Effect.fail(new HeldRollback());
        }
      })
    )
  );
  // A transaction that fails to open ends the fiber before `opened`.
  const { connection, context } = await Effect.runPromise(
    Effect.raceFirst(
      Deferred.await(opened),
      Effect.flatMap(Fiber.await(held), (exit) =>
        Effect.die(
          Exit.isFailure(exit)
            ? Cause.squash(exit.cause)
            : new Error("The held transaction ended before it opened")
        )
      )
    )
  );
  const end = async (outcome: "commit" | "rollback") => {
    await Effect.runPromise(Deferred.succeed(ending, outcome));
    const exit = await Effect.runPromise(Fiber.await(held));
    // Only the requested rollback is expected; any other reason is not.
    if (
      Exit.isFailure(exit) &&
      !exit.cause.reasons.every(
        (reason) =>
          Cause.isFailReason(reason) && reason.error instanceof HeldRollback
      )
    ) {
      throw Cause.squash(exit.cause);
    }
  };
  return {
    pool,
    context,
    query: async <Row>(sql: string, params: ReadonlyArray<unknown> = []) => {
      const statement = sql.trim().toLowerCase();
      if (statement === "begin") return { rows: [], rowCount: null };
      if (statement === "commit" || statement === "rollback") {
        await end(statement);
        return { rows: [], rowCount: null };
      }
      // Rejects with the driver's error, which carries the server's fields
      // (`code`, `constraint`) as node-postgres errors do.
      const { rows, rowCount } = (await Effect.runPromise(
        Effect.mapError(
          connection.executeRaw(sql, params),
          (error) => error.reason.cause
        )
      )) as NativeResult;
      return { rows: [...rows] as Row[], rowCount };
    },
    release: async () => {
      if (!Deferred.isDoneUnsafe(ending)) await end("rollback");
    },
  };
};

/**
 * Runs `use` with a database client that writes inside the held transaction,
 * such as one a test keeps open to leave its rows uncommitted. The client's
 * own transactions become savepoints named `effect_sql_<depth>`, so the
 * test's commit or rollback decides every write. Run its transactions one
 * after another: concurrent ones share a savepoint name.
 */
export const withHeldTransaction = <A, E, R>(
  held: HeldDatabaseConnection,
  use: (db: RootDatabaseClient) => Effect.Effect<A, E, R>
) =>
  Effect.flatMap(makeDatabaseClient(held.pool), (db) =>
    use(db).pipe(
      Effect.updateContext((current: Context.Context<R>) =>
        Context.merge(current, held.context)
      )
    )
  );

/** The columns a reservation and its mirrored order must agree on, as text. */
const reservationOrderColumns = [
  "id",
  "correlation_id",
  "created_at",
  "dotypos_customer_id",
  "payment_state",
  "fulfillment_state",
  "active_payment_attempt_id",
  "paid_at",
  "fulfilled_at",
  "fulfillment_failed_at",
  "fulfillment_failure_code",
] as const;

const reservationOrderProjection = reservationOrderColumns
  .map((column) => `${column}::text as ${column}`)
  .join(", ");

type ReservationOrderFacts = Record<
  (typeof reservationOrderColumns)[number] | "kind",
  string | null
>;

/**
 * Reads what the database mirror must keep equal: the reservation's facts as
 * a reservation order would hold them, the stored order with that ID, and the
 * order each of the reservation's payment attempts links to, oldest first.
 */
export const readReservationOrderMirror = async (
  pool: Pick<Pool, "query">,
  reservationId: string
) => {
  const read = async (table: "workspace_reservations" | "orders") =>
    (
      await pool.query<ReservationOrderFacts>(
        `select ${reservationOrderProjection}, ${
          table === "orders" ? "kind" : "'reservation'"
        } as kind from ${table} where id = $1`,
        [reservationId]
      )
    ).rows[0] ?? null;
  const attempts = await pool.query<{ readonly order_id: string | null }>(
    `select order_id from payment_attempts
      where workspace_reservation_id = $1
      order by created_at, id`,
    [reservationId]
  );
  return {
    expected: await read("workspace_reservations"),
    order: await read("orders"),
    attemptOrderIds: attempts.rows.map(({ order_id }) => order_id),
  };
};
