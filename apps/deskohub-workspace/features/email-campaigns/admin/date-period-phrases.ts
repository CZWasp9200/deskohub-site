import type { DatePeriodUnitType } from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import type { DatePeriod } from "../date-period";

/** A unit's name for one, and for any other count. */
export const datePeriodUnitNames: Readonly<
  Record<DatePeriodUnitType, { readonly one: string; readonly other: string }>
> = {
  day: { one: "day", other: "days" },
  week: { one: "week", other: "weeks" },
  month: { one: "month", other: "months" },
  year: { one: "year", other: "years" },
};

/**
 * The period as the Admin UI and audience summaries name it: "at any time",
 * "in the last 10 days", "from 2026-01-01 to 2026-03-31", "since 2026-01-01"
 * (through now), "from 2026-01-01 onward" (future included), or "until
 * 2026-01-01".
 */
export const describeDatePeriod = (period: DatePeriod): string =>
  Match.value(period).pipe(
    Match.tagsExhaustive({
      AnyTime: () => "at any time",
      Last: ({ count, unit }) =>
        count === 1
          ? `in the last ${datePeriodUnitNames[unit].one}`
          : `in the last ${count} ${datePeriodUnitNames[unit].other}`,
      Range: ({ from, to }) => `from ${from} to ${to}`,
      Since: ({ date }) => `since ${date}`,
      Onward: ({ date }) => `from ${date} onward`,
      Until: ({ date }) => `until ${date}`,
    })
  );
