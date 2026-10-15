import { Schema } from "effect";
import { administrationCalendarDate } from "./calendar-date";

export const DatePeriodUnit = Schema.Literals(["day", "week", "month", "year"]);
export type DatePeriodUnit = typeof DatePeriodUnit.Type;

/** No bound: every date counts. */
const anyTime = Schema.TaggedStruct("AnyTime", {});

/**
 * The last `count` units up to the evaluation time (a real send's send time).
 * Units step through the Prague calendar, so months and years keep their real
 * lengths across DST.
 */
const last = Schema.TaggedStruct("Last", {
  count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 })),
  unit: DatePeriodUnit,
});

/** Inclusive Prague calendar days. */
const range = Schema.TaggedStruct("Range", {
  from: administrationCalendarDate,
  to: administrationCalendarDate,
}).check(
  Schema.makeFilter(({ from, to }) => from <= to, {
    description: "The start date is on or before the end date.",
  })
);

/** From the start of this Prague calendar day through the evaluation time. */
const since = Schema.TaggedStruct("Since", {
  date: administrationCalendarDate,
});

/** From the start of this Prague calendar day on, future dates included. */
const onward = Schema.TaggedStruct("Onward", {
  date: administrationCalendarDate,
});

/** Up to and including this Prague calendar day. */
const until = Schema.TaggedStruct("Until", {
  date: administrationCalendarDate,
});

/**
 * A span of time an audience condition looks at. Every dated condition uses
 * it, so the Admin UI, summaries, and `dhw` name periods the same way.
 */
export const DatePeriod = Schema.Union([
  anyTime,
  last,
  range,
  since,
  onward,
  until,
]).annotate({
  identifier: "DatePeriod",
  description:
    "Any time, the last N days/weeks/months/years, an inclusive date range, since a date (through now), from a date onward (future included), or until a date (Prague calendar days).",
});
export type DatePeriod = typeof DatePeriod.Type;
