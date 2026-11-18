import { Option } from "effect";
import type { Locale } from "@/features/i18n";
import { getWorkspaceDate } from "@/features/reservation/reservation-date";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/** Whole workspace days (Prague) that a door code opens, both inclusive. */
export type ReservationAccessDays = {
  readonly firstDay: Temporal.PlainDate;
  readonly lastDay: Temporal.PlainDate;
};

const isWorkspaceMidnight = (instant: Temporal.Instant) =>
  getWorkspaceDate(instant)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant()
    .equals(instant);

/**
 * The days an access window covers when it starts and ends at workspace
 * midnight, as an office's does, so the page names dates instead of
 * midnight times. None for a window that starts or ends during a day.
 */
export const getReservationAccessDays = (
  accessStartsAt: Temporal.Instant,
  accessEndsAt: Temporal.Instant
): Option.Option<ReservationAccessDays> => {
  if (
    !(isWorkspaceMidnight(accessStartsAt) && isWorkspaceMidnight(accessEndsAt))
  ) {
    return Option.none();
  }
  const firstDay = getWorkspaceDate(accessStartsAt);
  const lastDay = getWorkspaceDate(accessEndsAt).subtract({ days: 1 });
  return Temporal.PlainDate.compare(lastDay, firstDay) < 0
    ? Option.none()
    : Option.some({ firstDay, lastDay });
};

/** An access day in the locale's numeric date form, such as 11/18/2026. */
export const formatReservationAccessDay = (
  day: Temporal.PlainDate,
  locale: Locale
) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(day.toZonedDateTime("UTC").epochMilliseconds);
