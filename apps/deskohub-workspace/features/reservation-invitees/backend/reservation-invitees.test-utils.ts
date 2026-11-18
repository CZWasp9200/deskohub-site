import { Effect, Layer, Option } from "effect";
import { ReservationInvitees } from "./reservation-invitees.service";

/** Invitee storage for a test whose reservations invited nobody. */
export const NoReservationInvitees = Layer.mock(ReservationInvitees, {
  findBookedPeople: () => Effect.succeed(Option.none()),
  findInvitedReservations: () => Effect.succeed([]),
});
