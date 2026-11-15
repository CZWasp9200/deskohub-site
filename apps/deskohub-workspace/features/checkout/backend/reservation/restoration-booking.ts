import type { DotyposReservationBooking } from "@deskohub/dotypos";
import { Data, Effect } from "effect";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";

/** The Dotypos record no longer holds the booking Workspace stored. */
export class RestorationBookingChanged extends Data.TaggedError(
  "RestorationBookingChanged"
)<{
  readonly message: string;
}> {}

/** The Dotypos record's booking can't be read. */
export class RestorationBookingUnreadable extends Data.TaggedError(
  "RestorationBookingUnreadable"
)<{
  readonly message: string;
}> {}

/**
 * The booking a restore asks Dotypos to confirm again: the reservation's
 * customer, and the table, held span and seats of its Dotypos record,
 * checked against the booking facts its stored details determine.
 */
export const getRestorationBooking = (_input: {
  readonly reservation: Pick<
    WorkspaceReservation,
    "id" | "dotyposCustomerId" | "reservationDetails"
  >;
  readonly record: ReservationRecord;
}): Effect.Effect<
  DotyposReservationBooking,
  RestorationBookingChanged | RestorationBookingUnreadable
> => Effect.die("getRestorationBooking is not implemented yet");
