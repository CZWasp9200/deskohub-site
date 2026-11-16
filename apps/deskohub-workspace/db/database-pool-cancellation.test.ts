import { describe, expect, test } from "bun:test";
import * as Net from "node:net";
import * as PgClient from "@effect/sql-pg/PgClient";
import { sql as drizzleSql } from "drizzle-orm";
import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Redacted,
  Scope,
} from "effect";
import { SqlClient } from "effect/sql";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { openDatabasePool } from "@/shared/testing/workspace-database-pool.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { WorkspaceDatabase } from "./database.service";
import { makeDatabaseClient } from "./database-client";
import { WorkspaceDatabaseAdvisoryLock } from "./postgres-advisory-lock";
import { WorkspaceLocks } from "./workspace-locks";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();
const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL ?? "";

const probeApplicationName = "deskohub-db-pool-cancellation-test";

/**
 * The Workspace's own pool settings, with a short client statement bound,
 * a long server one, and a backend that notices a closed socket at once.
 */
const makeProductionStyleProbe = async (maxConnections = 2) => {
  const pool = await openDatabasePool({
    connectionString: databaseUrl,
    maxConnections,
    statementTimeout: "500 millis",
    idleTimeout: "1 second",
    applicationName: probeApplicationName,
    startupParameters: {
      statement_timeout: "30000",
      // Without this a backend notices its closed socket only after pg_sleep
      // returns, so teardown could not be observed while the statement runs.
      client_connection_check_interval: "50",
    },
  });
  const db = await Effect.runPromise(makeDatabaseClient(pool));
  const layer = Layer.succeedContext(pool.postgres);
  return {
    pool,
    db,
    layer,
    stats: Context.get(pool.postgres, PgClient.PgClient).poolStats,
    close: () => pool.close().catch(() => {}),
  };
};

/**
 * A bare native client whose sockets the test controls: `onSocket` sees each
 * one the driver opens, including the extra one a CancelRequest uses.
 */
const makeControlledClient = async (onSocket: (socket: Net.Socket) => void) => {
  const server = new URL(databaseUrl);
  const scope = await Effect.runPromise(Scope.make());
  const postgres = await Effect.runPromise(
    Layer.buildWithScope(
      PgClient.layer({
        url: Redacted.make(databaseUrl),
        maxConnections: 1,
        prepare: false,
        applicationName: probeApplicationName,
        startupParameters: { client_connection_check_interval: "50" },
        stream: () => {
          const socket = Net.connect({
            host: server.hostname,
            port: Number(server.port),
          });
          onSocket(socket);
          return socket;
        },
      }),
      scope
    )
  );
  return {
    layer: Layer.succeedContext(postgres),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
};

// A CancelRequest is the one 16-byte frame carrying code 80877102.
const isCancelRequest = (chunk: Uint8Array) =>
  chunk.length === 16 &&
  new DataView(chunk.buffer, chunk.byteOffset, chunk.length).getInt32(4) ===
    80_877_102;

const observerQuery = <Row extends object>(
  text: string,
  values: ReadonlyArray<unknown> = []
) => postgresDatabase!.pool.query<Row>(text, [...values]);

const activeProbeBackendPids = async (): Promise<number[]> => {
  const result = await observerQuery<{ readonly pid: number }>(
    `select pid
       from pg_stat_activity
      where application_name = $1
        and pid <> pg_backend_pid()
        and state = 'active'
        and query like 'select pg_sleep%'`,
    [probeApplicationName]
  );
  return result.rows.map((row) => row.pid);
};

const isProbeBackendAlive = async (pid: number): Promise<boolean> => {
  const result = await observerQuery(
    `select 1
       from pg_stat_activity
      where application_name = $1
        and pid = $2
        and pid <> pg_backend_pid()`,
    [probeApplicationName, pid]
  );
  return result.rowCount === 1;
};

const pollUntil = async (
  condition: () => Promise<boolean>,
  deadlineMillis: number
): Promise<boolean> => {
  const deadline = Date.now() + deadlineMillis;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await Bun.sleep(20);
  }
  return condition();
};

const pollUntilProbeStatementActive = async (): Promise<number> => {
  let found: number | undefined;
  await pollUntil(async () => {
    found = (await activeProbeBackendPids())[0];
    return found !== undefined;
  }, 5_000);
  if (found === undefined) {
    throw new Error("Probe statement did not become active");
  }
  return found;
};

// Shorter than the probes' pg_sleep(3), so a statement only counts as ended
// when it stopped before it would have finished by itself.
const statementEndDeadlineMillis = 2_000;

/** Whether no probe backend still runs a pg_sleep statement. */
const observeStatementsEnded = () =>
  pollUntil(
    async () => (await activeProbeBackendPids()).length === 0,
    statementEndDeadlineMillis
  );

/**
 * What a released probe connection carries over to its next caller: open
 * transactions and advisory locks on any probe backend.
 */
const probeSessionLeftovers = async () => {
  const result = await observerQuery<{
    readonly inTransaction: number;
    readonly advisoryLocks: number;
  }>(
    `select
       (select count(*)::int from pg_stat_activity
         where application_name = $1 and pid <> pg_backend_pid()
           and state <> 'idle') as "inTransaction",
       (select count(*)::int from pg_locks l
          join pg_stat_activity a on a.pid = l.pid
         where a.application_name = $1 and l.locktype = 'advisory')
         as "advisoryLocks"`,
    [probeApplicationName]
  );
  return result.rows[0]!;
};

const backendPid = Effect.flatMap(SqlClient.SqlClient, (sql) =>
  Effect.map(
    sql<{ readonly pid: number }>`select pg_backend_pid()::int as pid`,
    ([row]) => row!.pid
  )
);

describe.skipIf(!postgresDatabase)(
  "Database pool cancellation against real Postgres",
  () => {
    test("an interrupted statement cannot harm other leased statements", async () => {
      const probe = await makeProductionStyleProbe();
      try {
        let innocentFailures = 0;
        for (let iteration = 0; iteration < 8; iteration++) {
          const innocentFailed = await Effect.runPromise(
            Effect.gen(function* () {
              const sql = yield* PgClient.PgClient;
              const blocker = yield* Effect.forkChild(
                sql`select pg_sleep(0.03)`
              );
              const victim = yield* Effect.forkChild(
                sql`select pg_sleep(0.01)`
              );
              const innocent = yield* Effect.forkChild(
                Effect.exit(sql`select pg_sleep(0.1)`)
              );
              yield* Effect.sleep("2 millis");
              yield* Fiber.interrupt(victim);
              const innocentExit = yield* Fiber.join(innocent);
              yield* Fiber.join(blocker);
              return Exit.isFailure(innocentExit);
            }).pipe(Effect.provide(probe.layer))
          );
          if (innocentFailed) innocentFailures += 1;
        }
        expect(innocentFailures).toBe(0);
      } finally {
        await probe.close();
      }
    });

    test("the client statement timeout ends a standalone statement and the pool recovers", async () => {
      const probe = await makeProductionStyleProbe();
      try {
        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const started = Date.now();
            const timedOut = yield* Effect.forkChild(
              probe.db
                .execute(drizzleSql`select pg_sleep(3)`)
                .pipe(Effect.timeout("4 seconds"))
            );
            yield* Effect.promise(pollUntilProbeStatementActive);
            const failure = yield* Fiber.await(timedOut);
            const failureMillis = Date.now() - started;
            const followUpStarted = Date.now();
            const followUp = yield* probe.db
              .execute(drizzleSql`select 42::int as n`)
              .pipe(Effect.timeout("2 seconds"));
            return {
              failure,
              failureMillis,
              followUp,
              followUpMillis: Date.now() - followUpStarted,
            };
          })
        );

        expect(Exit.isFailure(outcome.failure)).toBe(true);
        expect(
          Exit.isFailure(outcome.failure) && Cause.pretty(outcome.failure.cause)
        ).toContain("StatementTimeoutError");
        expect(outcome.failureMillis).toBeLessThan(2_500);
        expect(outcome.followUp.rows).toEqual([{ n: 42 }]);
        expect(outcome.followUpMillis).toBeLessThan(2_000);
        const stats = await Effect.runPromise(probe.stats);
        expect(stats.pending).toBe(0);
        expect(stats.idle + stats.used).toBeLessThanOrEqual(2);
        expect(await observeStatementsEnded()).toBe(true);
        expect(await probeSessionLeftovers()).toEqual({
          inTransaction: 0,
          advisoryLocks: 0,
        });
      } finally {
        await probe.close();
      }
    });

    test("the client statement timeout inside a Workspace transaction rolls it back without a transaction leak", async () => {
      const probe = await makeProductionStyleProbe();
      try {
        const { transaction } = WorkspaceDatabase.make(probe.db);
        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const started = Date.now();
            const timedOutTx = yield* Effect.forkChild(
              transaction(
                probe.db.execute(drizzleSql`select pg_sleep(3)`)
              ).pipe(Effect.timeout("4 seconds"))
            );
            yield* Effect.promise(pollUntilProbeStatementActive);
            const failure = yield* Fiber.await(timedOutTx);
            const failureMillis = Date.now() - started;
            const committed = yield* transaction(
              probe.db.execute(drizzleSql`select 6 * 7 as n`)
            ).pipe(Effect.timeout("2 seconds"));
            return { failure, failureMillis, committed };
          })
        );

        expect(Exit.isFailure(outcome.failure)).toBe(true);
        expect(outcome.failureMillis).toBeLessThan(2_500);
        expect(outcome.committed.rows).toEqual([{ n: 42 }]);
        expect(await observeStatementsEnded()).toBe(true);
        expect(await probeSessionLeftovers()).toEqual({
          inTransaction: 0,
          advisoryLocks: 0,
        });
      } finally {
        await probe.close();
      }
    });

    test("an interrupted transaction ends its statement without a transaction leak", async () => {
      const probe = await makeProductionStyleProbe();
      try {
        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const started = Date.now();
            const interruptedTx = yield* Effect.forkChild(
              sql
                .withTransaction(sql`select pg_sleep(3)`)
                .pipe(Effect.timeout("250 millis"))
            );
            yield* Effect.promise(pollUntilProbeStatementActive);
            const failure = yield* Fiber.await(interruptedTx);
            const failureMillis = Date.now() - started;
            const committed = yield* sql
              .withTransaction(sql<{ readonly n: number }>`select 7 * 6 as n`)
              .pipe(Effect.timeout("2 seconds"));
            return { failure, failureMillis, committed };
          }).pipe(Effect.provide(probe.layer))
        );

        expect(Exit.isFailure(outcome.failure)).toBe(true);
        expect(outcome.failureMillis).toBeLessThan(2_500);
        expect(outcome.committed[0]?.n).toBe(42);
        expect((await Effect.runPromise(probe.stats)).pending).toBe(0);
        expect(await observeStatementsEnded()).toBe(true);
        expect(await probeSessionLeftovers()).toEqual({
          inTransaction: 0,
          advisoryLocks: 0,
        });
      } finally {
        await probe.close();
      }
    });

    test("interrupted lock sections and bounded lock waits leave no lock, transaction or lock_timeout behind", async () => {
      // One connection for the transactions, so every next caller gets the
      // connection the interrupted one used (or the one replacing it).
      const probe = await makeProductionStyleProbe(1);
      const sectionProbe = await makeProductionStyleProbe(2);
      try {
        const { transaction } = WorkspaceDatabase.make(probe.db);
        const sections = WorkspaceDatabaseAdvisoryLock.make({
          client: Context.get(sectionProbe.pool.postgres, SqlClient.SqlClient),
          maxConnections: 2,
        });
        const account = `cancellation-${crypto.randomUUID()}`;
        // Interrupts after 0 to 9 ms, so across iterations the work stops
        // before, during and after its statements, and a statement may
        // finish within the driver's cancel grace or drain successfully.
        for (let iteration = 0; iteration < 30; iteration++) {
          const delay = Duration.millis(iteration % 10);
          await Effect.runPromise(
            Effect.gen(function* () {
              const lockWait = yield* Effect.forkChild(
                transaction(
                  WorkspaceLocks.referralGraph({
                    boundedWait: "5 seconds",
                  }).pipe(
                    Effect.andThen(
                      WorkspaceLocks.customerAccount(
                        account as CustomerAccountId
                      )
                    ),
                    Effect.andThen(Effect.sleep("20 millis"))
                  )
                )
              );
              const section = yield* Effect.forkChild(
                sections.withLock(
                  ["cancellation-test", account],
                  Effect.sleep("20 millis")
                )
              );
              yield* Effect.sleep(delay);
              yield* Fiber.interrupt(lockWait);
              yield* Fiber.interrupt(section);
            })
          );
          const setting = await Effect.runPromise(
            probe.db.execute(
              drizzleSql`select current_setting('lock_timeout') as timeout`
            )
          );
          expect(setting.rows).toEqual([{ timeout: "0" }]);
          expect(await probeSessionLeftovers()).toEqual({
            inTransaction: 0,
            advisoryLocks: 0,
          });
        }
      } finally {
        await probe.close();
        await sectionProbe.close();
      }
    });

    test("a cancellation the server never confirms replaces the backend", async () => {
      // Drops every CancelRequest, so the interrupted statement runs to its
      // end and the driver cannot know what ran on the session.
      const client = await makeControlledClient((socket) => {
        const write = socket.write.bind(socket) as (
          ...args: Array<unknown>
        ) => boolean;
        Object.assign(socket, {
          write: (...args: Array<unknown>) => {
            const [chunk] = args;
            if (chunk instanceof Uint8Array && isCancelRequest(chunk)) {
              socket.destroy();
              return true;
            }
            return write(...args);
          },
        });
      });
      try {
        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const before = yield* backendPid;
            const interrupted =
              yield* Effect.forkChild(sql`select pg_sleep(0.3)`);
            yield* Effect.promise(pollUntilProbeStatementActive);
            yield* Fiber.interrupt(interrupted);
            const after = yield* backendPid;
            return { before, after };
          }).pipe(Effect.provide(client.layer))
        );

        expect(outcome.after).not.toBe(outcome.before);
        expect(
          await pollUntil(
            async () => !(await isProbeBackendAlive(outcome.before)),
            2_000
          )
        ).toBe(true);
      } finally {
        await client.close();
      }
    });

    test("a connection whose socket failed mid-statement is never reused", async () => {
      const sockets: Array<Net.Socket> = [];
      const client = await makeControlledClient((socket) => {
        sockets.push(socket);
      });
      try {
        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const before = yield* backendPid;
            const broken = yield* Effect.forkChild(
              Effect.exit(sql`select pg_sleep(3)`)
            );
            yield* Effect.promise(pollUntilProbeStatementActive);
            sockets.at(-1)?.destroy();
            const failure = yield* Fiber.join(broken);
            const after = yield* backendPid;
            return { before, failure, after };
          }).pipe(Effect.provide(client.layer))
        );

        expect(Exit.isFailure(outcome.failure)).toBe(true);
        expect(outcome.after).not.toBe(outcome.before);
        expect(await observeStatementsEnded()).toBe(true);
      } finally {
        await client.close();
      }
    });

    test("runs plain statements, commits, and rollbacks through the native pool", async () => {
      const probe = await makeProductionStyleProbe();
      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            yield* sql`create table if not exists database_pool_cancellation_probe (n int)`;
            yield* sql`truncate database_pool_cancellation_probe`;
            const plain = yield* sql<{
              readonly n: number;
            }>`select 41 + 1 as n`;
            const committed = yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`insert into database_pool_cancellation_probe values (1)`;
                return yield* sql<{ readonly n: number }>`select 7 * 6 as n`;
              })
            );
            yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  yield* sql`insert into database_pool_cancellation_probe values (2)`;
                  return yield* Effect.fail("rollback requested" as const);
                })
              )
              .pipe(Effect.catch(() => Effect.void));
            const remaining = yield* sql<{
              readonly n: number;
            }>`select count(*)::int as n from database_pool_cancellation_probe`;
            return { plain, committed, remaining };
          }).pipe(Effect.provide(probe.layer))
        );

        expect(result.plain[0]?.n).toBe(42);
        expect(result.committed[0]?.n).toBe(42);
        expect(result.remaining[0]?.n).toBe(1);
      } finally {
        await probe.close();
      }
    });
  }
);
