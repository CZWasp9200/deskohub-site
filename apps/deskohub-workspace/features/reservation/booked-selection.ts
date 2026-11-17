import { Match, Option } from "effect";
import type { BookedReservation } from "@/features/reservation/backend/booked-reservation";
import { coworkSelectionLink } from "@/features/reservation/cowork-selection-link";
import { meetingRoomSelectionLink } from "@/features/reservation/meeting-room-selection-link";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import type { ReservationSelection } from "@/features/reservation/selection-path";

/**
 * The selection a stored reservation booked, as its family's reservation-page
 * link reopens it: the stored product and options over the booked interval.
 * `undefined` when no link can reopen it, such as a retired cowork tier, a
 * meeting room whose interval matches no duration, or an office booking that
 * isn't whole days.
 */
export const getBookedSelection = ({
  details,
  booked,
  timing,
}: {
  readonly details: StoredWorkspaceReservationDetails;
  readonly booked: Pick<BookedReservation, "seats">;
  /** The booked interval, which excludes a meeting room's early setup. */
  readonly timing: {
    readonly reservedFrom: Temporal.Instant;
    readonly reservedUntil: Temporal.Instant;
  };
}): ReservationSelection | undefined =>
  Match.value(details).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) =>
        coworkSelectionLink.fromStored({ ...cowork, ...timing }),
      "meeting-room": (meetingRoom) =>
        meetingRoomSelectionLink.fromStored({ ...meetingRoom, ...timing }),
      office: (office) => {
        // Unreadable Dotypos seats fall back to the stored selection's.
        const seats = Option.getOrUndefined(booked.seats) ?? office.seats;

        return seats === undefined
          ? undefined
          : officeSelectionLink.fromStored({ ...office, ...timing, seats });
      },
    })
  );
