import "server-only";

import { Duration, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { env } from "@/env";
import { shareAcrossRequests } from "@/shared/backend/share-across-requests";
import { WorkspaceDatabase } from "./database.service";
import {
  databaseClient,
  databasePostgresLayer,
  makeDatabasePool,
} from "./database-client";
import {
  databaseIdleCloseMillis,
  databaseIdleTimeout,
  databasePoolTimeouts,
} from "./database-pool-timeouts";
import { attachDatabaseReleaseReporter } from "./database-release-reporter";
import { WorkspaceDatabaseAdvisoryLock } from "./postgres-advisory-lock";

/**
 * Connections per function instance: the Workspace's native pool and Better
 * Auth's pool together open at most 10, as the one pool they shared did.
 * Sections take at most half of the Workspace's (`WorkspaceDatabaseAdvisoryLock`).
 */
const workspaceDatabaseConnections = 8;
const authDatabaseConnections = 2;

/** Both pools report each released connection, so Vercel waits for them. */
const reportRelease = attachDatabaseReleaseReporter(databaseIdleCloseMillis);

/** Better Auth's own node-postgres pool (drizzle node-postgres). */
export const authDatabasePool = makeDatabasePool({
  connectionString: env.DATABASE_URL,
  ...databasePoolTimeouts,
  max: authDatabaseConnections,
  idleTimeoutMillis: Duration.toMillis(databaseIdleTimeout),
});
authDatabasePool.on("release", reportRelease);

/** The Workspace's native pool, opened once per process. */
const workspacePostgres = shareAcrossRequests(
  databasePostgresLayer({
    connectionString: env.DATABASE_URL,
    maxConnections: workspaceDatabaseConnections,
    onRelease: reportRelease,
  })
);

export const workspaceDatabaseLayer = Layer.effect(
  WorkspaceDatabase,
  Effect.map(databaseClient, WorkspaceDatabase.make)
).pipe(Layer.provide(workspacePostgres));

export const workspaceDatabaseAdvisoryLockLayer = Layer.effect(
  WorkspaceDatabaseAdvisoryLock,
  Effect.map(SqlClient.SqlClient, (client) =>
    WorkspaceDatabaseAdvisoryLock.make({
      client,
      maxConnections: workspaceDatabaseConnections,
    })
  )
).pipe(Layer.provide(workspacePostgres));
