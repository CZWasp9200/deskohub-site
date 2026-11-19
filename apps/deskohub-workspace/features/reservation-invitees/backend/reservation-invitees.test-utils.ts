import { Effect, Layer, Option } from "effect";
import { ReservationInvitations } from "./reservation-invitations.service";
import { ReservationInvitees } from "./reservation-invitees.service";

/** Invitee storage for a test whose reservations invited nobody. */
export const NoReservationInvitees = Layer.mock(ReservationInvitees, {
  findBookedPeople: () => Effect.succeed(Option.none()),
  findInvitedReservations: () => Effect.succeed([]),
  deleteForAccount: () => Effect.void,
});

/** Invitations for a test whose reservations invited nobody. */
export const NoReservationInvitations = Layer.mock(ReservationInvitations, {
  bookerPeople: () => Effect.succeed(Option.none()),
});
