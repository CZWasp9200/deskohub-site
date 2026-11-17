import { DateTime, Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { workspaceTimeZone } from "../../i18n/date-time-format";

/** A booking's day as its date tile shows it. */
export interface DateTileParts {
  readonly weekday: string;
  readonly day: string;
  readonly month: string;
}

const tileFormat = (locale: AppLocale, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: workspaceTimeZone });

/**
 * The Prague day of `instant` as a date tile: short weekday, day of the
 * month, short month. Each part is its own format: reading parts by position
 * misreads on some engines (see `formatWorkspaceDays`).
 */
export const dateTileParts = (
  instant: DateTime.DateTime,
  locale: AppLocale
): DateTileParts => {
  const millis = DateTime.toEpochMillis(instant);
  return {
    weekday: tileFormat(locale, { weekday: "short" }).format(millis),
    day: tileFormat(locale, { day: "numeric" }).format(millis),
    month: tileFormat(locale, { month: "short" }).format(millis),
  };
};

const pragueDateFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: workspaceTimeZone,
});

// The Prague calendar date as days since the epoch.
const pragueDayNumber = (instant: DateTime.DateTime) =>
  Math.round(
    Date.parse(
      `${pragueDateFormat.format(DateTime.toEpochMillis(instant))}T00:00:00Z`
    ) / 86_400_000
  );

/** How far a booking is from now, as its ticket's header says it. */
export type BookingCountdown =
  /** The booking runs now. */
  | { readonly kind: "open-now" }
  /** It starts later today (Prague). */
  | { readonly kind: "today" }
  | { readonly kind: "tomorrow" }
  /** It starts in `days` Prague calendar days, two or more. */
  | { readonly kind: "days"; readonly days: number };

/**
 * The countdown to a booking from `start` to the exclusive `end`, at `now`;
 * none once it has ended.
 */
export const bookingCountdown = (
  now: DateTime.DateTime,
  start: DateTime.DateTime,
  end: DateTime.DateTime
): Option.Option<BookingCountdown> => {
  if (!DateTime.isLessThan(now, end)) return Option.none();
  if (!DateTime.isLessThan(now, start)) {
    return Option.some({ kind: "open-now" });
  }
  const days = pragueDayNumber(start) - pragueDayNumber(now);
  if (days <= 0) return Option.some({ kind: "today" });
  if (days === 1) return Option.some({ kind: "tomorrow" });
  return Option.some({ kind: "days", days });
};

/**
 * `days` with its unit, in the locale's plural form ("16 days"), from the
 * engine's unit format.
 */
export const formatDayCount = (days: number, locale: AppLocale): string =>
  new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "day",
    unitDisplay: "long",
  }).format(days);
