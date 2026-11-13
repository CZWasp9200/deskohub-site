import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";
import { authRelations } from "./schema";

export type AccountsDatabase = NodePgDatabase<typeof authRelations>;

// One pool per server instance; `globalThis` keeps it across dev hot reloads.
const globalStore = globalThis as typeof globalThis & {
  accountsDatabasePool?: Pool;
};

/**
 * The shared accounts database (accounts, memberships, events, trophies),
 * or `undefined` when this deployment has no `DATABASE_URL`. Callers treat
 * `undefined` as "accounts are unavailable" instead of failing the page.
 */
export function getAccountsDatabase(): AccountsDatabase | undefined {
  if (!env.DATABASE_URL) return undefined;

  globalStore.accountsDatabasePool ??= new Pool({
    connectionString: env.DATABASE_URL,
    // Serverless instances are short-lived and many; keep each one small.
    max: 3,
  });

  return drizzle({
    client: globalStore.accountsDatabasePool,
    relations: authRelations,
  });
}
