import { describe, expect, test } from "bun:test";
import * as PgClient from "@effect/sql-pg/PgClient";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Stream,
} from "effect";
import { SqlClient, type SqlConnection, SqlError } from "effect/sql";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type PostgresAdvisoryLockConnections,
  type PostgresAdvisoryLockKey,
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
  withPostgresAdvisoryLocks,
} from "./postgres-advisory-lock";
import { WorkspaceLockSections } from "./workspace-locks";

const key: PostgresAdvisoryLockKey = ["test-namespace", "resource-1"];

const toSqlError = (cause: unknown) =>
  new SqlError.SqlError({ reason: new SqlError.UnknownError({ cause }) });

type FakeQuery = (
  text: string,
  values: ReadonlyArray<unknown>
) => Promise<unknown>;

/**
 * Reserved connections over `query`, the way `SqlClient.reserve` hands them
 * out. Each records, when its scope closes, `undefined` when it went back
 * idle after a successful rollback, else the error that left its transaction
 * unfinished: the native driver retires a connection it gets back in a
 * failed or open transaction instead of reusing it.
 */
const makeFakeConnections = (options: {
  readonly query: () => FakeQuery;
  readonly failAcquire?: boolean;
}) => {
  const released: (unknown | undefined)[] = [];
  let connected = 0;
  const reserve = Effect.gen(function* () {
    connected += 1;
    if (options.failAcquire) {
      return yield* Effect.fail(toSqlError(new Error("pool exhausted")));
    }
    const query = options.query();
    let unfinished: unknown | undefined;
    const run = (text: string, values: ReadonlyArray<unknown>) =>
      Effect.tryPromise({
        try: () => query(text, values),
        catch: toSqlError,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            const statement = text.trim().toLowerCase();
            if (statement === "begin") unfinished = new Error("open");
            if (statement === "rollback" || statement === "commit") {
              unfinished = undefined;
            }
          })
        ),
        Effect.tapError((error) =>
          Effect.sync(() => {
            unfinished = error;
          })
        ),
        Effect.as([] as ReadonlyArray<never>)
      );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        released.push(unfinished);
      })
    );
    const connection: SqlConnection.Connection = {
      execute: (text, values) => run(text, values),
      executeUnprepared: (text, values) => run(text, values),
      executeValues: (text, values) => run(text, values),
      executeValuesUnprepared: (text, values) => run(text, values),
      executeRaw: (text, values) => run(text, values),
      executeStream: () => Stream.die(new Error("unused")),
    };
    return connection;
  });
  const client: PostgresAdvisoryLockConnections = { reserve };
  return {
    client,
    released,
    get connected() {
      return connected;
    },
  };
};

const makeFakePool = (options?: {
  readonly failAcquire?: boolean;
  readonly failLock?: boolean;
  readonly failRollback?: boolean;
}) => {
  const queries: string[] = [];
  const fake = makeFakeConnections({
    failAcquire: options?.failAcquire,
    query: () => (text) => {
      queries.push(text);
      if (options?.failLock && text.includes("pg_advisory_xact_lock")) {
        return Promise.reject(new Error("lock went wrong"));
      }
      if (options?.failRollback && text.includes("rollback")) {
        return Promise.reject(new Error("rollback went wrong"));
      }
      return Promise.resolve({ rows: [] });
    },
  });
  return { pool: fake.client, queries, released: fake.released };
};

const makeLayerPool = (max: number) => {
  const fake = makeFakePool();
  const connections = makeFakeConnections({
    query: () => () => Promise.resolve({ rows: [] }),
  });
  return {
    makeLayer: () =>
      Layer.succeed(
        WorkspaceDatabaseAdvisoryLock,
        WorkspaceDatabaseAdvisoryLock.make({
          client: connections.client,
          maxConnections: max,
        })
      ),
    queries: fake.queries,
    released: connections.released,
    get connected() {
      return connections.connected;
    },
    close: async () => {},
  };
};

const runLayerLock = <A, E, R>(
  layer: Layer.Layer<WorkspaceDatabaseAdvisoryLock>,
  lockKey: PostgresAdvisoryLockKey,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;
    return yield* advisoryLock.withLock(lockKey, effect);
  }).pipe(Effect.provide(layer));

const runLayerTransactionPermit = <A, E, R>(
  layer: Layer.Layer<WorkspaceDatabaseAdvisoryLock>,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;
    return yield* advisoryLock.withTransactionPermit(effect);
  }).pipe(Effect.provide(layer));

const makeTransactionPoolingPostgres = (serverSessionCount: number) => {
  type FakeServerSession = {
    readonly id: number;
    readonly sessionLocks: Set<string>;
    readonly transactionLocks: Set<string>;
    inTransaction: boolean;
  };

  const sessions: FakeServerSession[] = Array.from(
    { length: serverSessionCount },
    (_, id) => ({
      id,
      sessionLocks: new Set<string>(),
      transactionLocks: new Set<string>(),
      inTransaction: false,
    })
  );

  const routed: {
    readonly statement: string;
    readonly serverSession: number;
  }[] = [];

  let nextIdleSession = 0;

  const lockIdentity = (values?: ReadonlyArray<unknown>) =>
    (values ?? []).map((value) => String(value)).join("\u0000");

  const routeStatementToIdleSession = () => {
    const session = sessions[nextIdleSession % sessions.length]!;
    nextIdleSession += 1;
    return session;
  };

  const heldElsewhere = (session: FakeServerSession, identity: string) =>
    sessions.some(
      (other) =>
        other !== session &&
        (other.sessionLocks.has(identity) ||
          other.transactionLocks.has(identity))
    );

  const acquireAdvisoryLock = (
    session: FakeServerSession,
    scope: Set<string>,
    identity: string
  ): Promise<unknown> => {
    if (heldElsewhere(session, identity)) {
      return new Promise<never>(() => undefined);
    }
    scope.add(identity);
    return Promise.resolve({ rows: [] });
  };

  const makeProxyClient = (): FakeQuery => {
    let pinnedSession: FakeServerSession | undefined;

    return (text, values) => {
      const statement = text.trim().toLowerCase();

      if (statement === "begin") {
        const session = sessions.find((candidate) => !candidate.inTransaction);
        if (!session) {
          return Promise.reject(new Error("no idle server session"));
        }
        session.inTransaction = true;
        pinnedSession = session;
        routed.push({ statement, serverSession: session.id });
        return Promise.resolve({ rows: [] });
      }

      if (statement === "commit" || statement === "rollback") {
        const session = pinnedSession;
        pinnedSession = undefined;
        if (session) {
          session.inTransaction = false;
          session.transactionLocks.clear();
        }
        routed.push({ statement, serverSession: session?.id ?? -1 });
        return Promise.resolve({ rows: [] });
      }

      const session = pinnedSession ?? routeStatementToIdleSession();
      routed.push({ statement, serverSession: session.id });

      if (statement.includes("pg_advisory_xact_lock")) {
        return acquireAdvisoryLock(
          session,
          session.transactionLocks,
          lockIdentity(values)
        );
      }
      if (statement.includes("pg_advisory_lock")) {
        return acquireAdvisoryLock(
          session,
          session.sessionLocks,
          lockIdentity(values)
        );
      }
      if (statement.includes("pg_advisory_unlock")) {
        session.sessionLocks.delete(lockIdentity(values));
        return Promise.resolve({ rows: [{ pg_advisory_unlock: false }] });
      }
      return Promise.resolve({ rows: [] });
    };
  };

  const pool = makeFakeConnections({ query: makeProxyClient }).client;

  return {
    pool,
    routed,
    serverSessions: sessions,
    serverSessionsHoldingLock: () =>
      sessions
        .filter(
          (session) =>
            session.sessionLocks.size > 0 || session.transactionLocks.size > 0
        )
        .map((session) => session.id),
  };
};

describe("Postgres advisory lock helper", () => {
  test("holds the advisory lock in one explicit transaction, rolls the transaction back, then releases the client", async () => {
    const fake = makeFakePool();

    const result = await Effect.runPromise(
      withPostgresAdvisoryLock(fake.pool, key, Effect.succeed("inside"))
    );

    expect(result).toBe("inside");
    expect(fake.queries).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      "rollback",
    ]);
    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeUndefined();
  });

  test("acquires multiple keys on one transaction client", async () => {
    const fake = makeFakePool();

    const result = await Effect.runPromise(
      withPostgresAdvisoryLocks(
        fake.pool,
        [key, ["customer-account", "account-1"]],
        Effect.succeed("inside")
      )
    );

    expect(result).toBe("inside");
    expect(fake.queries).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      "rollback",
    ]);
    expect(fake.released).toHaveLength(1);
  });

  test("releases the advisory lock at transaction end so the next same-key scope does not stall under transaction pooling", async () => {
    const fake = makeTransactionPoolingPostgres(3);
    const mutexKey: PostgresAdvisoryLockKey = ["account-pooler", "profile-1"];

    const firstScope = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(fake.pool, mutexKey, Effect.succeed("first"))
    );

    expect(Exit.isSuccess(firstScope)).toBe(true);
    expect(fake.serverSessionsHoldingLock()).toEqual([]);

    const [begin, lock, rollback] = fake.routed;
    expect(begin?.statement).toBe("begin");
    expect(lock?.statement).toBe(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))"
    );
    expect(rollback?.statement).toBe("rollback");
    expect(begin?.serverSession).toBe(lock?.serverSession);
    expect(lock?.serverSession).toBe(rollback?.serverSession);

    const secondScope = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(
        fake.pool,
        mutexKey,
        Effect.succeed("second")
      ).pipe(Effect.timeout("1 second"))
    );

    expect(Exit.isSuccess(secondScope)).toBe(true);
    expect(fake.serverSessionsHoldingLock()).toEqual([]);
  });

  test("releases the client when the guarded effect fails", async () => {
    const fake = makeFakePool();
    const failure = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(
        fake.pool,
        key,
        Effect.fail(new Error("inside failure"))
      )
    );

    expect(failure._tag).toBe("Failure");
    expect(fake.queries).toHaveLength(3);
    expect(fake.queries[2]).toBe("rollback");
    expect(fake.released).toHaveLength(1);
  });

  test("releases the client when the guarded effect is interrupted", async () => {
    const fake = makeFakePool();
    const interruption = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(fake.pool, key, Effect.interrupt)
    );

    expect(interruption._tag).toBe("Failure");
    expect(fake.queries).toHaveLength(3);
    expect(fake.queries[2]).toBe("rollback");
    expect(fake.released).toHaveLength(1);
  });

  test("rolls back a BEGIN that the server finishes after its section was interrupted", async () => {
    const queries: string[] = [];
    const fake = makeFakeConnections({
      query: () => (text) => {
        queries.push(text);
        // The server runs BEGIN to its end whatever happens to the caller.
        return text === "begin"
          ? new Promise((resolve) => setTimeout(resolve, 50))
          : Promise.resolve({ rows: [] });
      },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const section = yield* Effect.forkChild(
          withPostgresAdvisoryLock(fake.client, key, Effect.never)
        );
        yield* Effect.sleep("10 millis");
        yield* Fiber.interrupt(section);
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(queries).toEqual(["begin", "rollback"]);
    expect(fake.released).toHaveLength(1);
  });

  test("maps pool acquisition failures to a SQL error and never releases", async () => {
    const fake = makeFakePool({ failAcquire: true });
    const error = await Effect.runPromise(
      withPostgresAdvisoryLock(
        fake.pool,
        key,
        Effect.succeed("unreachable")
      ).pipe(Effect.flip)
    );

    expect((error as { _tag?: string })._tag).toBe("SqlError");
    expect(fake.queries).toHaveLength(0);
    expect(fake.released).toHaveLength(0);
  });

  test("rolls the transaction back and fails with a SQL error when the lock cannot be taken", async () => {
    const fake = makeFakePool({ failLock: true });
    let guardedRuns = 0;

    const error = await Effect.runPromise(
      withPostgresAdvisoryLock(
        fake.pool,
        key,
        Effect.sync(() => {
          guardedRuns += 1;
        })
      ).pipe(Effect.flip)
    );

    expect(error._tag).toBe("SqlError");
    expect(guardedRuns).toBe(0);
    // The rollback ends the aborted transaction, so the connection goes back
    // idle; had it failed too, the driver would retire the connection.
    expect(fake.queries).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      "rollback",
    ]);
    expect(fake.released).toEqual([undefined]);
  });

  test("hands the connection back with its transaction unfinished when the rollback fails, so the driver retires it", async () => {
    const fake = makeFakePool({ failRollback: true });

    const result = await Effect.runPromise(
      withPostgresAdvisoryLock(fake.pool, key, Effect.succeed("inside"))
    );

    expect(result).toBe("inside");
    expect(fake.queries).toHaveLength(3);
    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeInstanceOf(Error);
    expect((fake.released[0] as { _tag?: string })._tag).toBe("SqlError");
  });

  test("keeps the guarded effect's failure when the rollback also fails", async () => {
    const fake = makeFakePool({ failRollback: true });
    const insideFailure = new Error("inside failure");

    const exit = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(fake.pool, key, Effect.fail(insideFailure))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(insideFailure);
    }
    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeInstanceOf(Error);
  });

  test("fails closed when the pool cannot leave a query connection available", async () => {
    const fake = makeLayerPool(1);

    try {
      const error = await Effect.runPromise(
        runLayerLock(
          fake.makeLayer(),
          ["capacity", "one"],
          Effect.succeed("unreachable")
        ).pipe(Effect.flip)
      );

      expect(SqlError.isSqlError(error)).toBe(true);
      if (SqlError.isSqlError(error)) {
        expect(error.message).toBe(
          "Postgres advisory lock pool capacity is too small"
        );
      }
      expect(fake.connected).toBe(0);
    } finally {
      await fake.close();
    }
  });

  test("transaction permits share the bounded-pool gate without taking another client", async () => {
    const fake = makeLayerPool(2);
    const layer = fake.makeLayer();
    let enterLock!: () => void;
    let releaseLock!: () => void;
    const lockEntered = new Promise<void>((resolve) => {
      enterLock = resolve;
    });
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let transactionEntered = false;
    let lockPromise: Promise<unknown> | undefined;
    let transactionPromise: Promise<unknown> | undefined;

    try {
      lockPromise = Effect.runPromise(
        runLayerLock(
          layer,
          ["transaction-permit", "shared"],
          Effect.promise(async () => {
            enterLock();
            await lockGate;
          })
        )
      );
      await lockEntered;
      transactionPromise = Effect.runPromise(
        runLayerTransactionPermit(
          layer,
          Effect.sync(() => {
            transactionEntered = true;
          })
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(transactionEntered).toBe(false);
      expect(fake.connected).toBe(1);

      releaseLock();
      await Promise.all([lockPromise, transactionPromise]);

      expect(transactionEntered).toBe(true);
      expect(fake.connected).toBe(1);
    } finally {
      releaseLock();
      await Promise.allSettled(
        [lockPromise, transactionPromise].filter(
          (promise): promise is Promise<unknown> => promise !== undefined
        )
      );
      await fake.close();
    }
  });

  test("fails closed when a transaction permit cannot leave a query connection available", async () => {
    const fake = makeLayerPool(1);
    const layer = fake.makeLayer();

    try {
      const error = await Effect.runPromise(
        runLayerTransactionPermit(layer, Effect.succeed("unreachable")).pipe(
          Effect.flip
        )
      );

      expect(SqlError.isSqlError(error)).toBe(true);
      if (SqlError.isSqlError(error)) {
        expect(error.message).toBe(
          "Postgres advisory lock pool capacity is too small"
        );
      }
      expect(fake.connected).toBe(0);
    } finally {
      await fake.close();
    }
  });

  test("shares one gate across layers for the same pool and holds it through transaction cleanup", async () => {
    const fake = makeLayerPool(2);
    const firstLayer = fake.makeLayer();
    const secondLayer = fake.makeLayer();
    const events: string[] = [];

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const firstEntered = yield* Deferred.make<void>();
          const releaseFirst = yield* Deferred.make<void>();
          const first = yield* Effect.forkChild(
            runLayerLock(
              firstLayer,
              ["layers", "first"],
              Effect.gen(function* () {
                events.push("first-entered");
                yield* Deferred.succeed(firstEntered, undefined);
                yield* Deferred.await(releaseFirst);
                events.push("first-left");
              })
            )
          );

          yield* Deferred.await(firstEntered);

          const second = yield* Effect.forkChild(
            runLayerLock(
              secondLayer,
              ["layers", "second"],
              Effect.sync(() => {
                expect(fake.released).toHaveLength(1);
                events.push("second-entered");
              })
            )
          );

          yield* Effect.sleep("10 millis");
          expect(events).toEqual(["first-entered"]);
          yield* Deferred.succeed(releaseFirst, undefined);
          yield* Fiber.join(first);
          yield* Fiber.join(second);
        })
      );

      expect(events).toEqual(["first-entered", "first-left", "second-entered"]);
      expect(fake.released).toHaveLength(2);
    } finally {
      await fake.close();
    }
  });

  test("releases the gate after a guarded effect fails", async () => {
    const fake = makeLayerPool(2);
    const layer = fake.makeLayer();

    try {
      const failure = await Effect.runPromiseExit(
        runLayerLock(
          layer,
          ["release", "failure"],
          Effect.fail("inside failure" as const)
        )
      );
      expect(Exit.isFailure(failure)).toBe(true);

      const result = await Effect.runPromise(
        runLayerLock(
          layer,
          ["release", "failure-next"],
          Effect.succeed("released")
        )
      );
      expect(result).toBe("released");
    } finally {
      await fake.close();
    }
  });

  test("releases the gate after a guarded effect is interrupted", async () => {
    const fake = makeLayerPool(2);
    const layer = fake.makeLayer();

    try {
      const interruption = await Effect.runPromiseExit(
        runLayerLock(layer, ["release", "interruption"], Effect.interrupt)
      );
      expect(Exit.isFailure(interruption)).toBe(true);

      await expect(
        Effect.runPromise(
          runLayerLock(
            layer,
            ["release", "interruption-next"],
            Effect.succeed("released")
          )
        )
      ).resolves.toBe("released");
    } finally {
      await fake.close();
    }
  });

  test("interrupting a waiting lock leaves the gate available", async () => {
    const fake = makeLayerPool(2);
    const layer = fake.makeLayer();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const firstEntered = yield* Deferred.make<void>();
          const releaseFirst = yield* Deferred.make<void>();
          const first = yield* Effect.forkChild(
            runLayerLock(
              layer,
              ["wait", "first"],
              Effect.gen(function* () {
                yield* Deferred.succeed(firstEntered, undefined);
                yield* Deferred.await(releaseFirst);
              })
            )
          );

          yield* Deferred.await(firstEntered);
          const waiter = yield* Effect.forkChild(
            runLayerLock(
              layer,
              ["wait", "second"],
              Effect.fail("interrupted waiter entered" as const)
            )
          );

          yield* Effect.sleep("10 millis");
          expect(fake.connected).toBe(1);
          yield* Fiber.interrupt(waiter);
          expect(Exit.isFailure(yield* Fiber.await(waiter))).toBe(true);
          yield* Deferred.succeed(releaseFirst, undefined);
          yield* Fiber.join(first);
        })
      );

      const result = await Effect.runPromise(
        runLayerLock(layer, ["wait", "third"], Effect.succeed("available"))
      );
      expect(result).toBe("available");
    } finally {
      await fake.close();
    }
  });
});

describe("Workspace lock sections", () => {
  test("a section holds its key for its effect only, and is not reentrant", async () => {
    const fake = makeLayerPool(4);
    const layer = fake.makeLayer();
    const first = "account-1" as CustomerAccountId;
    const second = "account-2" as CustomerAccountId;
    const enter = <A, E>(
      accountId: CustomerAccountId,
      effect: Effect.Effect<A, E, WorkspaceDatabaseAdvisoryLock>
    ) => WorkspaceLockSections.customerAccount(accountId)(effect);

    try {
      const run = <A, E>(
        effect: Effect.Effect<A, E, WorkspaceDatabaseAdvisoryLock>
      ) => Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));

      // Another key nests, and leaves when its section ends.
      expect(
        await run(
          enter(
            first,
            enter(second, Effect.void).pipe(
              Effect.andThen(enter(second, Effect.succeed("nested")))
            )
          )
        )
      ).toStrictEqual(Exit.succeed("nested"));
      expect(fake.connected).toBe(3);

      // The same key inside its own section dies before taking a connection.
      const reentered = await run(enter(first, enter(first, Effect.void)));
      expect(
        Exit.isFailure(reentered) &&
          Cause.pretty(reentered.cause).includes("not reentrant")
      ).toBe(true);
      expect(fake.connected).toBe(4);

      // The key leaves after a failed section too.
      expect(
        await run(enter(first, Effect.fail("failed" as const)))
      ).toStrictEqual(Exit.fail("failed"));
      expect(await run(enter(first, Effect.succeed("again")))).toStrictEqual(
        Exit.succeed("again")
      );
      expect(fake.released).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    } finally {
      await fake.close();
    }
  });
});

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "Postgres advisory lock against real Postgres",
  () => {
    for (const max of [2, 4] as const) {
      test(`keeps callbacks usable with a bounded pool of ${max}`, {
        timeout: 120_000,
      }, async () => {
        const pool = await openDatabasePool({
          connectionString: process.env.WORKSPACE_TEST_DATABASE_URL!,
          maxConnections: max,
        });
        const layer = WorkspaceDatabaseAdvisoryLock.makeLayer(pool);
        const selectOne = Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql`select 1`
        ).pipe(Effect.provideContext(pool.postgres));
        const stats = Context.get(pool.postgres, PgClient.PgClient).poolStats;

        try {
          // Keep the Effect deadline above the driver timeouts.
          const results = await Effect.runPromise(
            Effect.all(
              Array.from({ length: 10 }, (_, index) =>
                runLayerLock(
                  layer,
                  ["bounded-pool", `resource-${index}`],
                  selectOne.pipe(Effect.uninterruptible)
                )
              ),
              { concurrency: "unbounded" }
            ).pipe(Effect.timeout("45 seconds"))
          );

          expect(results).toHaveLength(10);
          expect(results.every((rows) => rows.length === 1)).toBe(true);

          const unrelated = await Effect.runPromise(selectOne);
          expect(unrelated).toHaveLength(1);
          const settled = await Effect.runPromise(stats);
          expect(settled.pending).toBe(0);
          expect(settled.used).toBe(0);
          expect(settled.idle + settled.used).toBeLessThanOrEqual(max);
        } finally {
          await pool.close();
        }
      });
    }

    test("serializes concurrent holders of the same key", async () => {
      const pool = Context.get(
        postgresDatabase!.databasePool.postgres,
        SqlClient.SqlClient
      );
      const events: string[] = [];

      const serialized = Effect.gen(function* () {
        const firstEntered = yield* Deferred.make<void>();

        const first = yield* Effect.forkChild(
          withPostgresAdvisoryLock(
            pool,
            ["account-test", "shared"],
            Effect.gen(function* () {
              events.push("first-entered");
              yield* Deferred.succeed(firstEntered, undefined);
              yield* Effect.sleep("50 millis");
              events.push("first-left");
            })
          ).pipe(Effect.orDie)
        );

        yield* Deferred.await(firstEntered);

        const second = yield* Effect.forkChild(
          withPostgresAdvisoryLock(
            pool,
            ["account-test", "shared"],
            Effect.sync(() => {
              events.push("second-entered");
            })
          ).pipe(Effect.orDie)
        );

        yield* Fiber.join(first);
        yield* Fiber.join(second);
      });

      await Effect.runPromise(serialized);

      expect(events.indexOf("second-entered")).toBeGreaterThan(
        events.indexOf("first-left")
      );
      expect(events[0]).toBe("first-entered");
    });
  }
);
