import type { Pool } from "pg";

/**
 * Resolves once a Postgres backend is blocked on the account advisory lock
 * for `account`, so lock tests prove a waiter exists instead of sleeping.
 * The key matches `withPostgresAdvisoryLock(["customer-account", account])`:
 * the two-int4 form stores each `hashtext` as an unsigned 32-bit id.
 */
export const waitForAccountAdvisoryLockWait = async (
  pool: Pick<Pool, "query">,
  account: string
) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(
      `
        select 1
        from pg_locks
        where locktype = 'advisory'
          and not granted
          and classid::bigint = (hashtext($1)::bigint & 4294967295)
          and objid::bigint = (hashtext($2)::bigint & 4294967295)
          and objsubid = 2
      `,
      ["customer-account", account]
    );
    if (waiting.rows.length > 0) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for the account advisory lock waiter.");
};
