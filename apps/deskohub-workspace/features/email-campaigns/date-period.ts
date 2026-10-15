import type { DatePeriodType } from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";

export type DatePeriod = DatePeriodType;

/**
 * A half-open instant interval: `[startsAtOrAfter, startsBefore)`. A missing
 * bound is open.
 */
export type DatePeriodBounds = {
  readonly startsAtOrAfter?: Temporal.Instant;
  readonly startsBefore?: Temporal.Instant;
};

const { timeZone } = workspaceSiteConstants.location;

const startOfDay = (date: string) =>
  Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") })
    .toInstant();

const startOfNextDay = (date: string) =>
  startOfDay(Temporal.PlainDate.from(date).add({ days: 1 }).toString());

const unitDurations = {
  day: (count: number) => ({ days: count }),
  week: (count: number) => ({ weeks: count }),
  month: (count: number) => ({ months: count }),
  year: (count: number) => ({ years: count }),
} as const;

/**
 * The instants a period covers when evaluated at `now`. Day bounds are Prague
 * midnights; "last N units" steps back through the Prague calendar, so a month
 * keeps its length and a DST change shifts no day. "Last N" and "since" end
 * at `now`; any time, "onward", and "until" leave the end open.
 */
export const datePeriodBounds = (
  period: DatePeriod,
  now: Temporal.Instant
): DatePeriodBounds =>
  Match.value(period).pipe(
    Match.tagsExhaustive({
      AnyTime: () => ({}),
      Last: ({ count, unit }) => ({
        startsAtOrAfter: now
          .toZonedDateTimeISO(timeZone)
          .subtract(unitDurations[unit](count))
          .toInstant(),
        startsBefore: now,
      }),
      Range: ({ from, to }) => ({
        startsAtOrAfter: startOfDay(from),
        startsBefore: startOfNextDay(to),
      }),
      Since: ({ date }) => ({
        startsAtOrAfter: startOfDay(date),
        startsBefore: now,
      }),
      Onward: ({ date }) => ({ startsAtOrAfter: startOfDay(date) }),
      Until: ({ date }) => ({ startsBefore: startOfNextDay(date) }),
    })
  );

/** Whether an instant lies in the bounds. */
export const isWithinDatePeriodBounds = (
  bounds: DatePeriodBounds,
  instant: Temporal.Instant
): boolean =>
  (bounds.startsAtOrAfter === undefined ||
    Temporal.Instant.compare(instant, bounds.startsAtOrAfter) >= 0) &&
  (bounds.startsBefore === undefined ||
    Temporal.Instant.compare(instant, bounds.startsBefore) < 0);
