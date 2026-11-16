import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";
import { siteConstants } from "@/shared/utils/constants";
import { authRelations } from "./schema";

export type AccountsDatabase = NodePgDatabase<typeof authRelations>;

// One pool per server instance; `globalThis` keeps it across dev hot reloads.
const globalStore = globalThis as typeof globalThis & {
  accountsDatabasePool?: Pool;
};

/**
 * The shared accounts database (accounts, memberships, events, trophies), or
 * `undefined` while accounts are off on this deployment: the feature flag is
 * off, or `DATABASE_URL` or `BETTER_AUTH_SECRET` is missing. Every page,
 * route and cron that touches account data asks here, so they all agree on
 * whether accounts exist.
 */
export function getAccountsDatabase(): AccountsDatabase | undefined {
  if (
    !(
      siteConstants.featureFlags.accounts &&
      env.DATABASE_URL &&
      env.BETTER_AUTH_SECRET
    )
  ) {
    return undefined;
  }

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
