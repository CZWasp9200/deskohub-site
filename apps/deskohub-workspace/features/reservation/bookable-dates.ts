import { getOfficeReservationMaximumEndsOn } from "@/features/reservation/office-reservation";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import { getWorkspaceAvailabilityRange } from "@/features/reservation/workspace-availability";

/**
 * The first and last Prague dates a booking of a reservation family can use on
 * a given day; for an office, both the first and the last day of the stay.
 */
export type BookableDates = {
  readonly earliest: string;
  readonly latest: string;
};

const getAvailabilityRangeDates = (today: Temporal.PlainDate) => {
  const range = getWorkspaceAvailabilityRange(today.toString());
  return { earliest: range.from, latest: range.to };
};

const bookableDatesByKind = {
  cowork: getAvailabilityRangeDates,
  "meeting-room": getAvailabilityRangeDates,
  office: (today) => ({
    earliest: today.toString(),
    latest: getOfficeReservationMaximumEndsOn(today).toString(),
  }),
} satisfies Record<
  WorkspaceReservationKind,
  (today: Temporal.PlainDate) => BookableDates
>;

/**
 * The window the catalog advertises for `today` and booking-selection
 * resolution checks, so the two can't drift apart.
 */
export const getBookableDates = (
  kind: WorkspaceReservationKind,
  today: Temporal.PlainDate
): BookableDates => bookableDatesByKind[kind](today);
