import { Data } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  type Instant,
  isMidnight,
  isWholeHour,
  type LocalDateTime,
} from "@/shared/utils/temporal";

export type ReservationInterval = {
  readonly startsAt: Instant;
  readonly endsAt: Instant;
};

export type ReservationIntervalInput = {
  readonly startsAt: Instant | LocalDateTime;
  readonly endsAt: Instant | LocalDateTime;
  readonly date?: never;
};

export type ReservationIntervalValidationIssue = {
  readonly path: keyof ReservationInterval;
  readonly message: string;
};

const getPragueLocalDateTimes = (interval: {
  readonly startsAt: ReservationInterval["startsAt"] | Temporal.Instant;
  readonly endsAt: ReservationInterval["endsAt"] | Temporal.Instant;
}) => ({
  start: Temporal.Instant.from(interval.startsAt)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDateTime(),
  end: Temporal.Instant.from(interval.endsAt)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDateTime(),
});

const isFullPragueCalendarDay = (
  start: Temporal.PlainDateTime,
  end: Temporal.PlainDateTime
) =>
  isMidnight(start) &&
  isMidnight(end) &&
  end.toPlainDate().equals(start.toPlainDate().add({ days: 1 }));

export const isSingleDayReservationInterval = (interval: {
  readonly startsAt: ReservationInterval["startsAt"] | Temporal.Instant;
  readonly endsAt: ReservationInterval["endsAt"] | Temporal.Instant;
}) => {
  const { start, end } = getPragueLocalDateTimes(interval);

  // Full Prague calendar day: midnight to the next midnight, including 23-
  // and 25-hour daylight-saving days.
  return isFullPragueCalendarDay(start, end);
};

const isOvernightStay = (
  start: Temporal.PlainDateTime,
  end: Temporal.PlainDateTime
) => {
  const changeover = Temporal.PlainTime.from(
    workspaceSiteConstants.openingHours.overnightStayChangeover
  );
  return (
    start.toPlainTime().equals(changeover) &&
    end.toPlainTime().equals(changeover) &&
    end.toPlainDate().equals(start.toPlainDate().add({ days: 1 }))
  );
};

/**
 * Whether an interval runs from the overnight changeover time on one Prague
 * date to the same wall-clock time on the next, including 23- and 25-hour
 * daylight-saving nights.
 */
export const isOvernightStayInterval = (interval: {
  readonly startsAt: ReservationInterval["startsAt"] | Temporal.Instant;
  readonly endsAt: ReservationInterval["endsAt"] | Temporal.Instant;
}) => {
  const { start, end } = getPragueLocalDateTimes(interval);
  return isOvernightStay(start, end);
};

export const isCoworkReservationInterval = (interval: {
  readonly startsAt: ReservationInterval["startsAt"] | Temporal.Instant;
  readonly endsAt: ReservationInterval["endsAt"] | Temporal.Instant;
}) => {
  const { start, end } = getPragueLocalDateTimes(interval);

  // Reserved Desk and historical cowork tiers use a full Prague calendar day.
  // Open Space ends at 17:00 on that same Prague date. An overnight Reserved
  // Desk stay runs from noon on its arrival date to noon the next date.
  return (
    isFullPragueCalendarDay(start, end) ||
    (isMidnight(start) &&
      end.hour === 17 &&
      isWholeHour(end) &&
      end.toPlainDate().equals(start.toPlainDate())) ||
    isOvernightStay(start, end)
  );
};

export class ReservationIntervalValidationError extends Data.TaggedError(
  "ReservationIntervalValidationError"
)<ReservationIntervalValidationIssue & { readonly cause?: unknown }> {}
