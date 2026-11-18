import { Data, Effect, Result } from "effect";
import {
  getOfficePeopleSeats,
  type OfficePeople,
  type OfficePeopleIssue,
  type ValidOfficePeople,
  validateOfficePeople,
} from "@/features/office/office-people";
import { getOfficeReservationIntervalInput } from "@/features/reservation/office-reservation";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

/**
 * Why a submitted people list can't book: one of the list's own issues, a
 * `seats` that isn't the list's head count, or a list sent with a reservation
 * that isn't a private office.
 */
export type OfficePeopleRejection =
  | OfficePeopleIssue
  | { readonly _tag: "SeatsMismatch" }
  | { readonly _tag: "NotOffice" };

export class OfficePeopleRejectedError extends Data.TaggedError(
  "OfficePeopleRejectedError"
)<{ readonly rejection: OfficePeopleRejection }> {}

/**
 * Checks the people a submission sends with its reservation, against the
 * reservation's contact email and seats. The booked `seats` are the list's
 * head count; booking checks them against the office's live capacity, so a
 * list longer than the office fails here as over capacity or there. None
 * when the submission sent no list: older apps and agents book `seats` alone.
 */
export const validateSubmittedOfficePeople = (
  people: OfficePeople | undefined,
  reservation: ReservationOrderData
): Effect.Effect<ValidOfficePeople | undefined, OfficePeopleRejectedError> => {
  if (people === undefined) return Effect.succeed(undefined);
  if (reservation.kind !== "office") {
    return Effect.fail(
      new OfficePeopleRejectedError({ rejection: { _tag: "NotOffice" } })
    );
  }
  const checked = validateOfficePeople(people, {
    seatCapacity: reservation.seats,
    contactEmail: reservation.email,
  });
  if (Result.isFailure(checked)) {
    return Effect.fail(
      new OfficePeopleRejectedError({ rejection: checked.failure })
    );
  }
  return getOfficePeopleSeats(checked.success) === reservation.seats
    ? Effect.succeed(checked.success)
    : Effect.fail(
        new OfficePeopleRejectedError({
          rejection: { _tag: "SeatsMismatch" },
        })
      );
};

/** When an office's access ends: the end of its last booked day in Prague. */
export const getOfficeAccessEndsAt = (reservation: {
  readonly startsOn: string;
  readonly endsOn: string;
}) =>
  Temporal.Instant.from(getOfficeReservationIntervalInput(reservation).endsAt);
