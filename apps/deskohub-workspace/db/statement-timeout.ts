import type * as PgClient from "@effect/sql-pg/PgClient";
import { Clock, Context, Deferred, Duration, Effect, Option } from "effect";
import { type SqlClient, SqlError } from "effect/sql";
import { databaseTimeouts } from "./database-pool-timeouts";

/**
 * Starts the timeout clock of the statement that checked the connection out.
 * Set by `boundFromCheckout`, read by the pool's `onAcquire` hook, which runs
 * in the fiber that uses the connection.
 */
const StatementCheckout = Context.Reference<(() => void) | undefined>(
  "@deskohub-workspace/db/StatementCheckout",
  { defaultValue: () => undefined }
);

/** Runs in the pool's `onAcquire` hook after each checkout. */
export const startStatementClock: Effect.Effect<void> = Effect.flatMap(
  StatementCheckout,
  (start) => Effect.sync(() => start?.())
);

/**
 * Retryable, like the code-less driver error pg's `query_timeout` produced
 * before, so `retryDatabaseRead` still retries a read that timed out.
 */
const statementTimedOut = (timeout: Duration.Duration) =>
  new SqlError.SqlError({
    reason: new SqlError.StatementTimeoutError({
      cause: new Error(
        `The statement did not finish within ${Duration.format(timeout)} of reaching its connection`
      ),
      message: "Database statement timed out on the client",
      operation: "execute",
    }),
  });

/**
 * The clock a run gets without one of its own. The database answers in real
 * time, so statement bounds and the driver's own waits run on this clock even
 * where a test moves a `TestClock`.
 */
const liveClock = Clock.Clock.defaultValue();

export const onLiveClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, Clock.Clock, liveClock);

const timedOutAfter = (timeout: Duration.Duration) =>
  onLiveClock(Effect.sleep(timeout)).pipe(
    Effect.andThen(Effect.fail(statementTimedOut(timeout)))
  );

/**
 * Bounds a statement on a connection it already holds. Timing out interrupts
 * it: the driver sends a CancelRequest and retires the connection unless the
 * server confirms the cancellation.
 */
export const boundStatement =
  (timeout: Duration.Duration) =>
  <A, E, R>(statement: Effect.Effect<A, E, R>) =>
    Effect.raceFirst(statement, timedOutAfter(timeout));

/**
 * Bounds a statement from the moment it checks out a connection, so waiting
 * for one stays bounded by the pool's acquire timeout alone, as pg's
 * `connectionTimeoutMillis` and `query_timeout` split it.
 */
const boundFromCheckout =
  (timeout: Duration.Duration) =>
  <A, E, R>(statement: Effect.Effect<A, E, R>) =>
    Effect.flatMap(Deferred.make<void>(), (checkedOut) =>
      Effect.raceFirst(
        Effect.provideService(statement, StatementCheckout, () => {
          Deferred.doneUnsafe(checkedOut, Effect.void);
        }),
        Deferred.await(checkedOut).pipe(Effect.andThen(timedOutAfter(timeout)))
      )
    );

/**
 * The client with every Drizzle statement bounded by `timeout`, its Temporal
 * parameters bound as text, and its waits for connections on the live clock. Drizzle runs
 * each query through `unsafe(sql, params)` and reads `values`,
 * `withoutTransform` or `raw` from it, so only those are bounded. A statement
 * inside a transaction runs on the transaction's connection, which the
 * Workspace transaction's own view bounds (`database.service.ts`). The
 * statements Effect SQL runs itself (BEGIN, COMMIT, ROLLBACK) and tagged
 * template statements outside a transaction are not bounded here.
 */
export const withStatementTimeout = <Client extends PgClient.PgClient>(
  client: Client,
  timeout: Duration.Duration
): Client => {
  const bounded = boundStatements(client, timeout);
  statementTimeouts.set(bounded, timeout);
  return bounded;
};

const statementTimeouts = new WeakMap<object, Duration.Duration>();

/**
 * The bound `withStatementTimeout` gave `client`, for statements that run on
 * a connection the client already handed out, such as a transaction's.
 */
export const statementTimeoutOf = (client: Pick<SqlClient.Base, "reserve">) =>
  statementTimeouts.get(client) ?? databaseTimeouts.statement;

/**
 * A Temporal value a raw `sql` template binds directly, outside any column's
 * encoder, goes as its ISO text, which the server types from the
 * parameter's context, as the previous driver sent it. The native driver
 * refuses objects it cannot type. It also refuses plain objects, nested
 * arrays and mixed-type arrays that node-postgres serialized; bind those
 * through a column's encoder or an explicit cast.
 */
type StatementParameter = NonNullable<
  Parameters<PgClient.PgClient["unsafe"]>[1]
>[number];

const bindableParameter = (value: StatementParameter): StatementParameter =>
  value instanceof Temporal.Instant ||
  value instanceof Temporal.ZonedDateTime ||
  value instanceof Temporal.PlainDate ||
  value instanceof Temporal.PlainDateTime ||
  value instanceof Temporal.PlainTime ||
  value instanceof Temporal.Duration
    ? value.toString()
    : value;

const boundStatements = <Client extends PgClient.PgClient>(
  client: Client,
  timeout: Duration.Duration
): Client => {
  const bound = <A, E, R>(statement: Effect.Effect<A, E, R>) =>
    Effect.flatMap(Effect.serviceOption(client.transactionService), (open) =>
      Option.isSome(open) ? statement : boundFromCheckout(timeout)(statement)
    );
  const boundedResults = new Set<PropertyKey>([
    "values",
    "withoutTransform",
    "raw",
  ]);
  const unsafe = (sql: string, params?: ReadonlyArray<unknown>) =>
    new Proxy(client.unsafe(sql, params?.map(bindableParameter)), {
      get: (target, key, receiver) => {
        const value = Reflect.get(target, key, receiver);
        return boundedResults.has(key) && Effect.isEffect(value)
          ? onLiveClock(bound(value))
          : value;
      },
    });
  // Waiting for a connection, BEGIN and COMMIT run on the live clock; the
  // transaction's body keeps the caller's.
  const withTransaction: PgClient.PgClient["withTransaction"] = (effect) =>
    Clock.clockWith((callerClock) =>
      onLiveClock(
        client.withTransaction(
          Effect.provideService(effect, Clock.Clock, callerClock)
        )
      )
    );
  const reserve = onLiveClock(client.reserve);
  const overrides = new Map<PropertyKey, unknown>([
    ["unsafe", unsafe],
    ["withTransaction", withTransaction],
    ["reserve", reserve],
  ]);
  return new Proxy(client, {
    get: (target, key, receiver) =>
      overrides.has(key)
        ? overrides.get(key)
        : Reflect.get(target, key, receiver),
  });
};
