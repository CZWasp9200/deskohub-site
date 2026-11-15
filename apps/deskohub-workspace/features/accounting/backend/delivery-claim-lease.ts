import "@/shared/polyfills/temporal";

import { type Column, eq, lt, type SQL, sql } from "drizzle-orm";

/** How long a claimed delivery stays processing before another worker may reclaim it. */
const deliveryProcessingLease = Temporal.Duration.from({ minutes: 1 });

/**
 * Matches a processing delivery of an email-delivery ledger (invoice emails,
 * cancellation notices) whose claim outlived its lease.
 */
export const isStaleDeliveryClaim = (ledger: {
  readonly state: Column;
  readonly updatedAt: Column;
}): SQL =>
  sql`(${eq(ledger.state, "processing")} and ${lt(
    ledger.updatedAt,
    Temporal.Now.instant().subtract(deliveryProcessingLease)
  )})`;
