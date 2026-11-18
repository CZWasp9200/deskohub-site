import { Data, DateTime, Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import {
  formatInstant,
  isSameWorkspaceDay,
  isWorkspaceMidnight,
} from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import type { AccessWindow, AccessWindowState } from "./access-window";
import { shortDate } from "./booking-ticket-text";
import {
  type BookingCountdown,
  bookingCountdown,
  formatDayCount,
} from "./booking-time";

/**
 * The lock's window as the PIN screen lists it: whole Prague days (one
 * "For" row) when it runs from midnight to a later midnight, else a From and
 * an Until row. The window is the server's; this only chooses how to say it.
 */
export type AccessWindowSpan = Data.TaggedEnum<{
  /** From the start of `first` to the end of `last`, both Prague days. */
  Days: { readonly first: DateTime.Utc; readonly last: DateTime.Utc };
  Times: { readonly from: DateTime.Utc; readonly until: DateTime.Utc };
}>;

export const AccessWindowSpan = Data.taggedEnum<AccessWindowSpan>();

/** The day before an exclusive end: the last day the window covers. */
const lastDayOf = (end: DateTime.Utc) =>
  DateTime.subtract(end, { milliseconds: 1 });

export const accessWindowSpanOf = ({
  startsAt,
  endsAt,
}: AccessWindow): AccessWindowSpan =>
  DateTime.isGreaterThan(endsAt, startsAt) &&
  isWorkspaceMidnight(startsAt) &&
  isWorkspaceMidnight(endsAt)
    ? AccessWindowSpan.Days({ first: startsAt, last: lastDayOf(endsAt) })
    : AccessWindowSpan.Times({ from: startsAt, until: endsAt });

/**
 * The end the status chip names: its time alone on the day it is read,
 * else its date and time.
 */
export type AccessMoment = Data.TaggedEnum<{
  Time: { readonly at: DateTime.Utc };
  DateTime: { readonly at: DateTime.Utc };
}>;

export const AccessMoment = Data.taggedEnum<AccessMoment>();

/** What the status chip under the PIN says. */
export type AccessChip = Data.TaggedEnum<{
  /** Not working yet: from when, and how many Prague days away. */
  Starts: {
    readonly at: DateTime.Utc;
    readonly countdown: BookingCountdown;
  };
  /** Working now, until its end. */
  Active: { readonly until: AccessMoment };
  /** No longer working since its end. */
  Ended: { readonly at: DateTime.Utc };
}>;

export const AccessChip = Data.taggedEnum<AccessChip>();

/** An end at midnight belongs to the day it closes, as that day's 24:00. */
const endMoment = (end: DateTime.Utc, now: DateTime.Utc): AccessMoment =>
  isSameWorkspaceDay(now, isWorkspaceMidnight(end) ? lastDayOf(end) : end)
    ? AccessMoment.Time({ at: end })
    : AccessMoment.DateTime({ at: end });

/** The chip for the window's state at `now`. */
export const accessChipOf = (
  state: AccessWindowState,
  { startsAt, endsAt }: AccessWindow,
  now: DateTime.Utc
): AccessChip => {
  switch (state._tag) {
    case "Upcoming":
      return AccessChip.Starts({
        at: startsAt,
        // An upcoming window hasn't ended, so the countdown is always there.
        countdown: Option.getOrElse(
          bookingCountdown(now, startsAt, endsAt),
          (): BookingCountdown => ({ kind: "today" })
        ),
      });
    case "Open":
      return AccessChip.Active({ until: endMoment(endsAt, now) });
    case "Ended":
      return AccessChip.Ended({ at: endsAt });
  }
};

// 13:00 on any day: a time format that writes it with "13" is a 24-hour clock.
const oneInTheAfternoon = DateTime.makeUnsafe("2026-01-01T12:00:00Z");

/**
 * A window's start or end as a date and a time in the device's clock. On
 * a 24-hour clock a Prague midnight that ends a window reads as 24:00 of the day it closes
 * (the boards' "until 24:00"); a 12-hour clock keeps its own midnight.
 */
export const accessMomentParts = (
  at: DateTime.Utc,
  locale: AppLocale,
  side: "start" | "end"
): { readonly date: string; readonly time: string } =>
  side === "end" &&
  isWorkspaceMidnight(at) &&
  formatInstant(oneInTheAfternoon, locale, "time").includes("13")
    ? { date: shortDate(lastDayOf(at), locale), time: "24:00" }
    : { date: shortDate(at, locale), time: formatInstant(at, locale, "time") };

/** A From or Until value: the short date and the time. */
export const accessDateTimeText = (
  at: DateTime.Utc,
  locale: AppLocale,
  side: "start" | "end"
) => m.reservations_date_time(accessMomentParts(at, locale, side), { locale });

/** The For row's value: one day, or the first and last day. */
export const accessDaysText = (
  first: DateTime.Utc,
  last: DateTime.Utc,
  locale: AppLocale
): string =>
  isSameWorkspaceDay(first, last)
    ? shortDate(first, locale)
    : m.reservations_time_range(
        { start: shortDate(first, locale), end: shortDate(last, locale) },
        { locale }
      );

const momentText = (moment: AccessMoment, locale: AppLocale) =>
  AccessMoment.$match(moment, {
    Time: ({ at }) => accessMomentParts(at, locale, "end").time,
    DateTime: ({ at }) => accessDateTimeText(at, locale, "end"),
  });

const startsWhenText = (countdown: BookingCountdown, locale: AppLocale) => {
  switch (countdown.kind) {
    case "open-now":
    case "today":
      return m.reservations_access_starts_today({}, { locale });
    case "tomorrow":
      return m.reservations_access_starts_tomorrow({}, { locale });
    case "days":
      return m.reservations_access_starts_in_days(
        { days: formatDayCount(countdown.days, locale) },
        { locale }
      );
  }
};

/** The chip's text. */
export const accessChipText = (chip: AccessChip, locale: AppLocale): string =>
  AccessChip.$match(chip, {
    // A start at a Prague midnight (a whole day) is named by its date alone.
    Starts: ({ at, countdown }) =>
      m.reservations_access_chip_starts(
        {
          start: isWorkspaceMidnight(at)
            ? shortDate(at, locale)
            : accessDateTimeText(at, locale, "start"),
          when: startsWhenText(countdown, locale),
        },
        { locale }
      ),
    Active: ({ until }) =>
      m.reservations_access_chip_active(
        { end: momentText(until, locale) },
        { locale }
      ),
    Ended: ({ at }) =>
      m.reservations_access_chip_ended(accessMomentParts(at, locale, "end"), {
        locale,
      }),
  });
