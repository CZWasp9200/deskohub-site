import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { SqlClient, type SqlConnection } from "effect/sql";
import type { Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { type DatabasePool, makeDatabaseClient, makeDatabasePool, type RootDatabaseClient } from "@/db/database-client";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";
import { createScratchPostgresDatabase } from "./postgres-scratch-database.test-utils";
import { fixtureReservationAuthorId } from "./workspace-fixtures.test-utils";

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
  const pool = makeDatabasePool({
    connectionString: databaseUrl,
    ...databasePoolTimeouts,
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
 * One connection of the database's native pool, held by the test, which runs
 * its own `begin`, `commit` or `rollback` through `query`. `query` answers as
 * node-postgres does (`rows`, `rowCount`), with the native driver's values.
 */
export interface HeldDatabaseConnection {
  readonly pool: DatabasePool;
  readonly connection: SqlConnection.Connection;
  readonly query: <Row>(
    sql: string,
    params?: ReadonlyArray<unknown>
  ) => Promise<{ readonly rows: Row[]; readonly rowCount: number | null }>;
  /** Hands the connection back; the driver retires it mid-transaction. */
  readonly release: () => Promise<void>;
}

type NativeResult = {
  readonly rows: ReadonlyArray<unknown>;
  readonly rowCount: number | null;
};

export const holdDatabaseConnection = (database: {
  readonly databasePool: DatabasePool;
}): Promise<HeldDatabaseConnection> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const pool = database.databasePool;
      const scope = yield* Scope.make();
      const connection = yield* Scope.provide(
        Context.get(pool.postgres, SqlClient.SqlClient).reserve,
        scope
      );
      return {
        pool,
        connection,
        query: <Row>(sql: string, params: ReadonlyArray<unknown> = []) =>
          Effect.runPromise(connection.executeRaw(sql, params)).then(
            (result) => {
              const { rows, rowCount } = result as NativeResult;
              return { rows: [...rows] as Row[], rowCount };
            }
          ),
        release: () => Effect.runPromise(Scope.close(scope, Exit.void)),
      };
    })
  );

/**
 * Runs `use` with a database client that writes inside the transaction the
 * held connection has open, such as one a test began with `begin` to keep
 * its rows uncommitted. The client's own transactions become savepoints named
 * `effect_sql_<depth>`, so the test's commit or rollback decides every write.
 * Run its transactions one after another: concurrent ones share a savepoint
 * name. The test keeps owning the connection and its transaction, and
 * releases it.
 */
export const withHeldTransaction = <A, E, R>(
  held: HeldDatabaseConnection,
  use: (db: RootDatabaseClient) => Effect.Effect<A, E, R>
) =>
  Effect.flatMap(makeDatabaseClient(held.pool), (db) =>
    use(db).pipe(
      Effect.provideService(db.$client.transactionService, [held.connection, 0])
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
