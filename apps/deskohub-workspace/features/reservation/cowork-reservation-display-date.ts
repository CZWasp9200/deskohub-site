import type { Locale } from "@/features/i18n";
import type { WorkspaceCoworkProductTier } from "@/features/reservation/cowork-reservation-product";
import { getBookedCoworkStay } from "@/features/reservation/cowork-stay";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateTimeRange,
} from "@/features/reservation/reservation-date";

/**
 * When a booked cowork reservation holds its desk, as reservation summaries
 * show it: a day stay is its date; an overnight stay ends on the next date, so
 * it shows both dates with their times.
 */
export const formatCoworkReservationDisplayDate = (
  reservation: {
    readonly tier: WorkspaceCoworkProductTier;
    readonly interval: {
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
    };
  },
  locale: Locale
) =>
  getBookedCoworkStay(reservation) === "overnight"
    ? formatReservationDisplayDateTimeRange(
        reservation.interval.startsAt,
        reservation.interval.endsAt,
        locale
      )
    : formatReservationDisplayDate(reservation.interval.startsAt, locale);
