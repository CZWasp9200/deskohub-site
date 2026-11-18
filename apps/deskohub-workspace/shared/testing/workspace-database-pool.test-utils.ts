import { Effect, Exit, Layer, Scope } from "effect";
import {
  type DatabasePool,
  type DatabasePoolSettings,
  databasePostgresLayer,
} from "@/db/database-client";

/**
 * Opens a native Workspace pool outside any layer, for a test that closes it
 * itself. The pool connects lazily, so an unreachable server fails its first
 * statement, not this.
 */
export const openDatabasePool = (
  settings: DatabasePoolSettings
): Promise<DatabasePool> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const postgres = yield* Layer.buildWithScope(
        databasePostgresLayer(settings),
        scope
      ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
      return {
        postgres,
        maxConnections: settings.maxConnections,
        close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
      };
    })
  );
