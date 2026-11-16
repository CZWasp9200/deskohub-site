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
 * A moment the status chip names, as far as it needs: a time on the day
 * it is read, a whole day for a window that ends at midnight (the end of
 * that day), else a date and time.
 */
export type AccessMoment = Data.TaggedEnum<{
  Time: { readonly at: DateTime.Utc };
  Day: { readonly day: DateTime.Utc };
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
  Ended: { readonly at: AccessMoment };
}>;

export const AccessChip = Data.taggedEnum<AccessChip>();

const endMoment = (end: DateTime.Utc, now: DateTime.Utc): AccessMoment => {
  if (isWorkspaceMidnight(end))
    return AccessMoment.Day({ day: lastDayOf(end) });
  return isSameWorkspaceDay(now, end)
    ? AccessMoment.Time({ at: end })
    : AccessMoment.DateTime({ at: end });
};

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
      return AccessChip.Ended({
        at: isWorkspaceMidnight(endsAt)
          ? AccessMoment.Day({ day: lastDayOf(endsAt) })
          : AccessMoment.DateTime({ at: endsAt }),
      });
  }
};

/** A From or Until value: the short date and the time. */
export const accessDateTimeText = (at: DateTime.Utc, locale: AppLocale) =>
  m.reservations_date_time(
    { date: shortDate(at, locale), time: formatInstant(at, locale, "time") },
    { locale }
  );

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
    Time: ({ at }) => formatInstant(at, locale, "time"),
    Day: ({ day }) => shortDate(day, locale),
    DateTime: ({ at }) => accessDateTimeText(at, locale),
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
    Starts: ({ at, countdown }) =>
      m.reservations_access_chip_starts(
        {
          start: accessDateTimeText(at, locale),
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
      AccessMoment.$is("Day")(at)
        ? m.reservations_access_chip_ended_day(
            { date: shortDate(at.day, locale) },
            { locale }
          )
        : m.reservations_access_chip_ended(
            {
              date: shortDate(at.at, locale),
              time: formatInstant(at.at, locale, "time"),
            },
            { locale }
          ),
  });
