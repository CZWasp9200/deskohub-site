import { describe, expect, test } from "bun:test";
import {
  type DatePeriod,
  datePeriodBounds,
  isWithinDatePeriodBounds,
} from "./date-period";

/** 12:00 in Prague (CEST). */
const now = Temporal.Instant.from("2026-10-15T10:00:00Z");
const millisecond = { milliseconds: 1 } as const;

const within = (period: DatePeriod, instant: Temporal.Instant) =>
  isWithinDatePeriodBounds(datePeriodBounds(period, now), instant);

describe("datePeriodBounds", () => {
  test.each<DatePeriod>([
    { _tag: "Last", count: 1, unit: "day" },
    { _tag: "Since", date: "2026-10-01" },
  ])("includes the evaluation time in %o, and nothing after it", (period) => {
    expect(within(period, now)).toBe(true);
    expect(within(period, now.add(millisecond))).toBe(false);
  });

  test("starts the last N units at their first instant, inclusive", () => {
    const start = Temporal.Instant.from("2026-10-14T10:00:00Z");
    const lastDay: DatePeriod = { _tag: "Last", count: 1, unit: "day" };
    expect(within(lastDay, start)).toBe(true);
    expect(within(lastDay, start.subtract(millisecond))).toBe(false);
  });

  test.each<DatePeriod>([
    { _tag: "Until", date: "2026-10-20" },
    { _tag: "Range", from: "2026-10-01", to: "2026-10-20" },
  ])("ends %o before the next Prague midnight", (period) => {
    const nextMidnight = Temporal.Instant.from("2026-10-20T22:00:00Z");
    expect(within(period, nextMidnight.subtract(millisecond))).toBe(true);
    expect(within(period, nextMidnight)).toBe(false);
  });

  test("leaves from-onward open into the future", () => {
    expect(
      within({ _tag: "Onward", date: "2026-10-01" }, now.add({ hours: 1000 }))
    ).toBe(true);
  });
});
