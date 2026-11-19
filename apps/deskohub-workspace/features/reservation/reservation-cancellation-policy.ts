import type { WorkspaceReservationRow } from "@/db/schema";

/** How long a `cancelling` claim stays its owner's before another may resume it. */
export const REQUESTED_CANCELLATION_RETRY_AFTER_MS = 60 * 1000;

/**
 * Whether an administrator or the customer may cancel the reservation now: it
 * has a Dotypos booking, isn't being confirmed or delivered, has no pending
 * payment unless that is allowed, and is in a cancellable state or a stale
 * cancellation.
 */
export const canCancelReservation = (
  reservation: Pick<
    WorkspaceReservationRow,
    | "dotyposReservationId"
    | "fulfillmentState"
    | "paymentState"
    | "reservationState"
    | "updatedAt"
  >,
  now = Temporal.Now.instant(),
  allowPendingPayment = false
) =>
  Boolean(reservation.dotyposReservationId?.trim()) &&
  reservation.fulfillmentState !== "processing" &&
  reservation.fulfillmentState !== "awaiting_delivery" &&
  (allowPendingPayment || reservation.paymentState !== "pending") &&
  (["held", "hold_expired", "confirmed", "cancellation_failed"].includes(
    reservation.reservationState
  ) ||
    (reservation.reservationState === "cancelling" &&
      Temporal.Instant.compare(
        reservation.updatedAt,
        now.subtract({
          milliseconds: REQUESTED_CANCELLATION_RETRY_AFTER_MS,
        })
      ) <= 0));
