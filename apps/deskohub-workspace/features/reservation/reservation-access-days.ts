import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/**
 * The Prague days a door code works on, first and last inclusive, as
 * `YYYY-MM-DD`. One day when `from` and `through` are the same.
 */
export interface ReservationAccessDays {
  readonly from: string;
  readonly through: string;
}

/**
 * The days an access window covers when it starts and ends at Prague
 * midnight, as an office's whole-day access does; none for a window that
 * starts or ends within a day.
 */
export const getReservationAccessDays = (window: {
  readonly accessStartsAt: Temporal.Instant;
  readonly accessEndsAt: Temporal.Instant;
}): ReservationAccessDays | undefined => {
  const { timeZone } = workspaceSiteConstants.location;
  const startsAt = window.accessStartsAt.toZonedDateTimeISO(timeZone);
  const endsAt = window.accessEndsAt.toZonedDateTimeISO(timeZone);
  const isMidnight = (at: Temporal.ZonedDateTime) => at.equals(at.startOfDay());
  if (!isMidnight(startsAt) || !isMidnight(endsAt)) return undefined;
  const through = endsAt.toPlainDate().subtract({ days: 1 });
  if (Temporal.PlainDate.compare(through, startsAt.toPlainDate()) < 0) {
    return undefined;
  }
  return {
    from: startsAt.toPlainDate().toString(),
    through: through.toString(),
  };
};
