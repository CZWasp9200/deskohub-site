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

/** One day in the calendar grid; days of the neighbouring months fill gaps. */
export type CalendarCell = {
  readonly date: Temporal.PlainDate;
  readonly inMonth: boolean;
};

/**
 * The month laid out as Monday-first weeks of seven days. The first and last
 * weeks are filled with days of the neighbouring months, marked as outside
 * the month, so every cell has its own date to be keyed by.
 */
export function calendarWeeks(
  month: Temporal.PlainYearMonth
): CalendarCell[][] {
  const firstDay = month.toPlainDate({ day: 1 });
  const lastDay = month.toPlainDate({ day: month.daysInMonth });
  const gridStart = firstDay.subtract({ days: firstDay.dayOfWeek - 1 });
  const gridEnd = lastDay.add({ days: 7 - lastDay.dayOfWeek });

  const weeks: CalendarCell[][] = [];
  for (
    let day = gridStart;
    Temporal.PlainDate.compare(day, gridEnd) <= 0;
    day = day.add({ days: 1 })
  ) {
    if (day.dayOfWeek === 1) weeks.push([]);
    weeks.at(-1)?.push({
      date: day,
      inMonth: day.year === month.year && day.month === month.month,
    });
  }
  return weeks;
}
