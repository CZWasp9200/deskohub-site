import { siteConstants } from "@/shared/utils/constants";

/**
 * Month arithmetic for the events calendar. Everything is computed in the
 * bar's time zone, so an event at 23:30 lands on the right day no matter
 * where the server or the visitor is.
 */

const timeZone = siteConstants.workingHours.timezone;

const toZoned = (date: Date): Temporal.ZonedDateTime =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(
    timeZone
  );

export const dayOf = (date: Date): Temporal.PlainDate =>
  toZoned(date).toPlainDate();

export const currentMonth = (now: Date = new Date()): Temporal.PlainYearMonth =>
  dayOf(now).toPlainYearMonth();

/** The `?month=` value that shows the month an event starts in. */
export const monthParam = (date: Date): string =>
  dayOf(date).toPlainYearMonth().toString();

/**
 * Reads the `?month=YYYY-MM` query value. Anything missing, malformed, or
 * outside 2000–2100 shows the current month instead of an error page.
 */
export function parseMonthParam(
  value: string | undefined,
  now: Date = new Date()
): Temporal.PlainYearMonth {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    try {
      const month = Temporal.PlainYearMonth.from(value);
      if (month.year >= 2000 && month.year <= 2100) return month;
    } catch {
      // Falls through to the current month.
    }
  }
  return currentMonth(now);
}

/** The instants a month starts and ends at: `[from, to)`. */
export function monthRange(month: Temporal.PlainYearMonth): {
  from: Date;
  to: Date;
} {
  const startOf = (yearMonth: Temporal.PlainYearMonth): Date =>
    new Date(
      yearMonth.toPlainDate({ day: 1 }).toZonedDateTime(timeZone)
        .epochMilliseconds
    );
  return { from: startOf(month), to: startOf(month.add({ months: 1 })) };
}

/**
 * The month laid out as Monday-first weeks. Cells outside the month are
 * `null`, so every week has exactly seven cells.
 */
export function calendarWeeks(
  month: Temporal.PlainYearMonth
): (Temporal.PlainDate | null)[][] {
  const firstDay = month.toPlainDate({ day: 1 });
  const cells: (Temporal.PlainDate | null)[] = Array.from(
    { length: firstDay.dayOfWeek - 1 },
    () => null
  );
  for (let day = 1; day <= month.daysInMonth; day++) {
    cells.push(month.toPlainDate({ day }));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Temporal.PlainDate | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}
