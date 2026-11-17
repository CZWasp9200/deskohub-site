import type { Locale } from "@/features/i18n";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { overnightCoworkStayTier } from "@/features/reservation/cowork-stay";
import { formatReservationDisplayDateTimeRange } from "@/features/reservation/reservation-date";

/**
 * An overnight Reserved Desk stay from its arrival `date`, as the exact
 * Prague start and end the customer holds the desk between.
 */
export const formatCoworkOvernightStay = (date: string, locale: Locale) => {
  const { startsAt, endsAt } = getCoworkReservationInterval(
    overnightCoworkStayTier,
    date,
    "overnight"
  );
  return formatReservationDisplayDateTimeRange(
    Temporal.Instant.from(startsAt),
    Temporal.Instant.from(endsAt),
    locale
  );
};
