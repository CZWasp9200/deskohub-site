import { Duration } from "effect";
import type { PoolConfig } from "pg";

export type DatabasePoolTimeouts = Pick<
  PoolConfig,
  "connectionTimeoutMillis" | "query_timeout" | "statement_timeout"
>;

const queryTimeoutMillis = 10_000;
const statementTimeoutMillis = 10_000;
const acquireConnectionHeadroomMillis = 5_000;
const connectTimeoutMillis =
  queryTimeoutMillis + acquireConnectionHeadroomMillis;

/** Better Auth's `pg.Pool` and raw test pools. */
export const databasePoolTimeouts = {
  connectionTimeoutMillis: connectTimeoutMillis,
  query_timeout: queryTimeoutMillis,
  statement_timeout: statementTimeoutMillis,
} satisfies DatabasePoolTimeouts;

/**
 * The same bounds for the native Effect pool. `connect` bounds both opening
 * a connection and waiting for a free one, as pg's `connectionTimeoutMillis`
 * does; `statement` is sent as the `statement_timeout` startup parameter and
 * also bounds each statement on the client (`statement-timeout.ts`), since
 * Neon's pooler ignores that parameter.
 */
export const databaseTimeouts = {
  connect: Duration.millis(connectTimeoutMillis),
  statement: Duration.millis(statementTimeoutMillis),
} as const;

/**
 * How long a released connection stays open. The native pool's reaper closes
 * it between one and two of these after release; Vercel keeps a function
 * instance awake for `databaseIdleCloseMillis` after each release so that it
 * happens before the instance suspends.
 */
export const databaseIdleTimeout = Duration.seconds(5);
export const databaseIdleCloseMillis =
  2 * Duration.toMillis(databaseIdleTimeout);
