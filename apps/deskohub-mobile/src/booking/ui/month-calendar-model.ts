import { Option } from "effect";
import type { DateChoice } from "../selection/booking-selection";
import {
  monthOf,
  monthWeeks,
  type PragueDate,
  type PragueMonth,
} from "../selection/prague-date";

/**
 * How a day of the calendar shows. A day the customer can't pick is `past`
 * before the earliest bookable date, `outside-range` after the latest, and
 * `unavailable` (struck through) in between; each wins over `selected`, so a
 * selection the calendar no longer offers isn't shown as a valid pick.
 */
export type CalendarDayState =
  | "selected"
  | "available"
  | "unavailable"
  | "past"
  | "outside-range";

/** Where a day sits in a multi-day range: its first, a middle or its last day. */
type CalendarRangePart = "start" | "middle" | "end";

export interface CalendarDay {
  readonly date: PragueDate;
  /** The day of the month, 1..31. */
  readonly day: number;
  readonly state: CalendarDayState;
  readonly today: boolean;
  /** The day's place in the highlighted range, when it's a bookable day in it. */
  readonly range: Option.Option<CalendarRangePart>;
  /** The day the customer tapped to learn why it's unavailable. */
  readonly focused: boolean;
}

/** An inclusive span of days, such as an office booking's days. */
export interface CalendarRange {
  readonly start: PragueDate;
  readonly end: PragueDate;
}

export interface MonthCalendarModel {
  /** The month shown, kept within the months the dates span. */
  readonly month: PragueMonth;
  /** Monday-first weeks of seven cells; days of other months are empty. */
  readonly weeks: ReadonlyArray<ReadonlyArray<Option.Option<CalendarDay>>>;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
}

const monthIndex = ({ year, month }: PragueMonth) => year * 12 + month - 1;

/** `month` moved into the months from `earliest`'s to `latest`'s. */
const withinDates = (month: PragueMonth, dates: DateChoice): PragueMonth => {
  const first = monthOf(dates.earliest);
  const last = monthOf(dates.latest);
  if (monthIndex(month) < monthIndex(first)) return first;
  if (monthIndex(month) > monthIndex(last)) return last;
  return month;
};

const dayState = (
  date: PragueDate,
  dates: DateChoice,
  selected: PragueDate | undefined
): CalendarDayState => {
  if (date < dates.earliest) return "past";
  if (date > dates.latest) return "outside-range";
  if (dates.unavailable.has(date)) return "unavailable";
  return date === selected ? "selected" : "available";
};

const bookable = (state: CalendarDayState) =>
  state === "selected" || state === "available";

// A range of one day is just that day: no band to draw.
const rangePart = (
  date: PragueDate,
  range: CalendarRange | undefined
): Option.Option<CalendarRangePart> => {
  if (!range || range.start >= range.end) return Option.none();
  if (date < range.start || date > range.end) return Option.none();
  if (date === range.start) return Option.some("start");
  if (date === range.end) return Option.some("end");
  return Option.some("middle");
};

/** The month a calendar opens on: the selected date's, else the earliest's. */
export const initialCalendarMonth = (
  dates: DateChoice,
  selected: PragueDate | undefined
): PragueMonth => withinDates(monthOf(selected ?? dates.earliest), dates);

/** The days of `month` and whether the calendar can page away from it. */
export const monthCalendarModel = ({
  month: requested,
  dates,
  selected,
  today,
  range,
  focused,
}: {
  readonly month: PragueMonth;
  readonly dates: DateChoice;
  readonly selected: PragueDate | undefined;
  readonly today?: PragueDate;
  readonly range?: CalendarRange;
  readonly focused?: PragueDate;
}): MonthCalendarModel => {
  const month = withinDates(requested, dates);
  return {
    month,
    weeks: monthWeeks(month).map((week) =>
      week.map(
        Option.map((date): CalendarDay => {
          const state = dayState(date, dates, selected);
          return {
            date,
            day: Number(date.slice(8)),
            state,
            today: date === today,
            range: bookable(state) ? rangePart(date, range) : Option.none(),
            focused: date === focused,
          };
        })
      )
    ),
    canGoPrevious: monthIndex(month) > monthIndex(monthOf(dates.earliest)),
    canGoNext: monthIndex(month) < monthIndex(monthOf(dates.latest)),
  };
};
