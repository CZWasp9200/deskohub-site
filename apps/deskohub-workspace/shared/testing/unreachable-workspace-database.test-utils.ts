import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { type DatabasePool, makeDatabaseClient } from "@/db/database-client";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";

export interface UnreachableWorkspaceDatabase {
  readonly database: Layer.Layer<WorkspaceDatabase>;
  readonly advisoryLock: Layer.Layer<WorkspaceDatabaseAdvisoryLock>;
  /** Close it when the test is done. */
  readonly pool: DatabasePool;
}

/**
 * A Workspace database whose every statement and lock fails with a real
 * connection error: nothing listens on port 1.
 */
export const connectUnreachableWorkspaceDatabase =
  async (): Promise<UnreachableWorkspaceDatabase> => {
    const pool = await openDatabasePool({
      connectionString: "postgres://workspace:workspace@127.0.0.1:1/workspace",
      maxConnections: 10,
    });
    const db = await Effect.runPromise(makeDatabaseClient(pool));
    return {
      database: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db)),
      advisoryLock: WorkspaceDatabaseAdvisoryLock.makeLayer(pool),
      pool,
    };
  };
