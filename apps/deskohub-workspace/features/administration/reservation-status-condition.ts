import { and, eq, isNotNull, or, type SQL, sql } from "drizzle-orm";
import { paymentAttempts, workspaceReservations } from "@/db/schema";
import type { AdministrationReservationStatusFilter } from "./administration.service";

const notCancelledCondition = sql`${workspaceReservations.reservationState} not in ('cancelled', 'cancelling', 'cancellation_failed')`;

/** A reservation the customer received: fulfilled and never cancelled. */
export const successfulReservationCondition = and(
  sql`${workspaceReservations.fulfillmentState} = 'fulfilled'`,
  notCancelledCondition
)!;

/**
 * A reservation the customer booked: confirmed and never cancelled, whether or
 * not fulfillment succeeded. Abandoned and expired checkouts never confirm.
 */
export const bookedReservationCondition = and(
  isNotNull(workspaceReservations.reservationConfirmedAt),
  notCancelledCondition
)!;

const needsRefundCondition = sql`exists (
  select 1 from ${paymentAttempts}
  where ${paymentAttempts.workspaceReservationId} = ${workspaceReservations.id}
    and ${paymentAttempts.refundState} = 'required'
)`;

/**
 * SQL condition selecting Workspace reservations in an operator-facing status
 * group, so every reservation filter shares the admin status vocabulary.
 */
export const reservationStatusCondition = (
  status: AdministrationReservationStatusFilter
): SQL => {
  if (status === "needs_refund") {
    return needsRefundCondition;
  }
  if (status === "complete") {
    return successfulReservationCondition;
  }
  if (status === "cancelled") {
    return and(
      sql`${workspaceReservations.fulfillmentState} <> 'failed'`,
      sql`${workspaceReservations.fulfillmentState} <> 'fulfilled'`,
      sql`${workspaceReservations.reservationState} <> 'cancellation_failed'`,
      or(
        eq(workspaceReservations.reservationState, "cancelled"),
        eq(workspaceReservations.reservationState, "hold_expired")
      )
    )!;
  }
  return and(
    sql`${workspaceReservations.fulfillmentState} <> 'failed'`,
    sql`${workspaceReservations.fulfillmentState} <> 'fulfilled'`,
    sql`${workspaceReservations.reservationState} not in ('cancelled', 'hold_expired', 'cancellation_failed')`
  )!;
};
