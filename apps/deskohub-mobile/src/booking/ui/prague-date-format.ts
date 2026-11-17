import type { CustomerLocale } from "@deskohub/workspace-customer-api";
import { deviceHour12 } from "../../i18n/device-clock";
import { type PragueDate, pragueDateTimeAt } from "../selection/prague-date";

/**
 * A Prague calendar date as the customer reads it, such as "Friday 13
 * November". The date is formatted at its UTC noon in UTC, so no time zone
 * moves it to another day.
 */
export const formatPragueDate = (
  date: PragueDate,
  locale: CustomerLocale,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
  }
): string =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`)
  );

/** A day as the booking boards write it in a line: "Thu 26 Nov". */
export const formatShortPragueDate = (
  date: PragueDate,
  locale: CustomerLocale
): string =>
  formatPragueDate(date, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** The device's clock as format options; none when it doesn't say. */
const deviceClockOptions = (
  hour12: boolean | undefined
): Intl.DateTimeFormatOptions => {
  if (hour12 === undefined) return {};
  return hour12 ? { hour12: true } : { hourCycle: "h23" };
};

/**
 * A Prague time of day, HH:mm, as the customer reads it: on the device's
 * clock, 12- or 24-hour, as the tickets and the PIN screen write times
 * (one time format across the app). A 24-hour clock runs 00–23, so midnight
 * never reads "24:00". The time is formatted on a fixed day in UTC, so no
 * time zone moves it.
 */
export const formatPragueTime = (
  time: string,
  locale: CustomerLocale
): string => {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...deviceClockOptions(deviceHour12()),
    timeZone: "UTC",
  }).format(new Date(`1970-01-01T${time}:00Z`));
};

/** The Prague time of day at `instant`, written as {@link formatPragueTime} writes it. */
export const formatPragueTimeAt = (
  instant: Date,
  locale: CustomerLocale
): string => {
  const { hour, minute } = pragueDateTimeAt(instant);
  return formatPragueTime(
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    locale
  );
};
