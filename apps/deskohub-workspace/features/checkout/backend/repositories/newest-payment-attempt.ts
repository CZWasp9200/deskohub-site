import { desc, eq, type SQLWrapper } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { paymentAttempts } from "@/db/schema";

/**
 * The order a reservation's payment attempts were admitted in, newest
 * first: an order has at most one attempt in progress, and a retry always
 * pays the order again after its newest attempt.
 */
export const newestPaymentAttemptsFirst = [
  desc(paymentAttempts.createdAt),
  desc(paymentAttempts.id),
] as const;

/**
 * The id of the newest payment attempt of the reservation `reservationId`
 * names, as a scalar subquery for a condition on that reservation's row.
 */
export const newestPaymentAttemptIdOf = (
  db: WorkspaceDatabaseClient,
  reservationId: PgColumn | SQLWrapper
) =>
  db
    .select({ id: paymentAttempts.id })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.workspaceReservationId, reservationId))
    .orderBy(...newestPaymentAttemptsFirst)
    .limit(1);
