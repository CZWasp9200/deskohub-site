import * as PgClient from "@effect/sql-pg/PgClient";
import { EffectCache } from "drizzle-orm/cache/core/cache-effect";
import { type EffectPgDatabase, make } from "drizzle-orm/effect-postgres";
import { type Context, Duration, Effect, Layer, Redacted } from "effect";
import type { SqlClient } from "effect/sql";
import { Pool, type PoolConfig } from "pg";
import { DatabaseQueryLoggerLive } from "@/shared/backend/logging/database-query-logger";
import {
  databaseIdleTimeout,
  databaseTimeouts,
} from "./database-pool-timeouts";
import { normalizePostgresConnectionUrl } from "./postgres-connection-url";
import { drizzleRawTypeParsers } from "./postgres-type-parsers";
import { relations } from "./relations";
import {
  onLiveClock,
  startStatementClock,
  withStatementTimeout,
} from "./statement-timeout";

export type DatabaseClient = EffectPgDatabase<typeof relations>;

/**
 * A client over its own SQL client (`makeDatabaseClient`, Drizzle's `make`),
 * as opposed to a transaction's executor. `WorkspaceDatabase.make` takes one.
 */
export type RootDatabaseClient = DatabaseClient & {
  readonly $client: SqlClient.Base;
};

/**
 * A node-postgres pool: Better Auth's (drizzle node-postgres) and tests' raw
 * observation pools. Workspace Effect SQL runs on `databasePostgresLayer`.
 */
export const makeDatabasePool = (
  config: Omit<PoolConfig, "connectionString" | "types"> & {
    readonly connectionString: string;
  }
) =>
  new Pool({
    ...config,
    connectionString: normalizePostgresConnectionUrl(config.connectionString),
    types: drizzleRawTypeParsers,
  });

export interface DatabasePoolSettings {
  readonly connectionString: string;
  /** Connections the pool opens at most. */
  readonly maxConnections: number;
  /** Defaults to `databaseIdleTimeout`. */
  readonly idleTimeout?: Duration.Input | undefined;
  readonly applicationName?: string | undefined;
  /** Session settings beyond `statement_timeout`, such as a test's. */
  readonly startupParameters?: Readonly<Record<string, string>> | undefined;
  /** Defaults to `databaseTimeouts.statement`. */
  readonly statementTimeout?: Duration.Input | undefined;
  /** Bounds opening a connection and waiting for one; defaults to `databaseTimeouts.connect`. */
  readonly connectTimeout?: Duration.Input | undefined;
  /** Called each time a checked-out connection goes back to the pool. */
  readonly onRelease?: (() => void) | undefined;
}

/**
 * The native Effect Postgres pool and client, opened lazily. Named prepared
 * statements are off: a transaction-mode pooler without prepared-statement
 * tracking fails them inside transactions, and a cached plan whose result
 * type a migration changed fails the transaction it runs in.
 */
export const databasePostgresLayer = (settings: DatabasePoolSettings) => {
  const statementTimeout = Duration.fromInputUnsafe(
    settings.statementTimeout ?? databaseTimeouts.statement
  );
  const connectTimeout = settings.connectTimeout ?? databaseTimeouts.connect;
  const onRelease = settings.onRelease;
  return PgClient.layerFrom(
    Effect.map(
      // On the live clock, so the pool's idle reaper keeps real time even
      // when a test builds it under a TestClock.
      onLiveClock(
        PgClient.make({
          url: Redacted.make(
            normalizePostgresConnectionUrl(settings.connectionString)
          ),
          maxConnections: settings.maxConnections,
          minConnections: 0,
          idleTimeout: settings.idleTimeout ?? databaseIdleTimeout,
          connectTimeout,
          acquireTimeout: connectTimeout,
          prepare: false,
          applicationName: settings.applicationName,
          startupParameters: {
            statement_timeout: String(Duration.toMillis(statementTimeout)),
            ...settings.startupParameters,
          },
          onAcquire:
            onRelease === undefined
              ? startStatementClock
              : Effect.andThen(
                  startStatementClock,
                  Effect.addFinalizer(() => Effect.sync(onRelease))
                ),
        })
      ),
      (client) => withStatementTimeout(client, statementTimeout)
    )
  ).pipe(
    // With no minimum connections the pool opens none while it is built, so
    // building fails only on invalid settings: a defect, as constructing a
    // `pg.Pool` was. Statements and checkouts still fail with `SqlError`.
    Layer.orDie
  );
};

/**
 * The services a database client runs on besides its Postgres client: the
 * query cache and the query logger.
 */
const databaseClientServices = Layer.merge(
  EffectCache.Default,
  DatabaseQueryLoggerLive
);

/** A Drizzle client over the Postgres client in context. */
export const databaseClient: Effect.Effect<
  RootDatabaseClient,
  never,
  PgClient.PgClient
> = make({
  relations,
  // Drizzle 1.0.0-rc.4 always kept a failed query's parameters on its error;
  // the Workspace's log censorship reads their count.
  paramsInErrors: true,
}).pipe(Effect.provide(databaseClientServices));

/** A native pool its owner opened and closes, such as a test's (`openDatabasePool`). */
export interface DatabasePool {
  readonly postgres: Context.Context<PgClient.PgClient | SqlClient.SqlClient>;
  readonly maxConnections: number;
  readonly close: () => Promise<void>;
}

export const makeDatabaseClient = (pool: DatabasePool) =>
  Effect.provideContext(databaseClient, pool.postgres);
