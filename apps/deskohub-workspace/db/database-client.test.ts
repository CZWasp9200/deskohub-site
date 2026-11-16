import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { SqlError } from "effect/sql";
import { WorkspaceDatabase } from "./database.service";
import { databaseClient, databasePostgresLayer } from "./database-client";

// Nothing listens on port 1.
const unreachable = databasePostgresLayer({
  connectionString: "postgres://workspace:workspace@127.0.0.1:1/workspace",
  maxConnections: 2,
  connectTimeout: "500 millis",
});

describe("databasePostgresLayer", () => {
  test("builds without connecting, and its first statement fails with a SqlError", async () => {
    const layer = Layer.effect(
      WorkspaceDatabase,
      Effect.map(databaseClient, WorkspaceDatabase.make)
    ).pipe(Layer.provide(unreachable));

    const built = await Effect.runPromiseExit(
      Effect.scoped(Layer.build(layer))
    );
    expect(Exit.isSuccess(built)).toBe(true);

    const queried = await Effect.runPromiseExit(
      Effect.flatMap(WorkspaceDatabase, ({ db }) =>
        db.execute(sql`select 1`)
      ).pipe(Effect.provide(layer))
    );
    expect(Exit.isFailure(queried)).toBe(true);
    if (Exit.isFailure(queried)) {
      expect(Cause.hasDies(queried.cause)).toBe(false);
      const failure = Option.getOrUndefined(
        Cause.findErrorOption(queried.cause)
      );
      const sqlError = SqlError.isSqlError(failure)
        ? failure
        : Option.getOrUndefined(
            Option.filter(
              Cause.isCause((failure as { readonly cause?: unknown })?.cause)
                ? Cause.findErrorOption(
                    (failure as { readonly cause: Cause.Cause<unknown> }).cause
                  )
                : Option.none(),
              SqlError.isSqlError
            )
          );
      expect(sqlError?.reason._tag).toBe("ConnectionError");
    }
  });
});
