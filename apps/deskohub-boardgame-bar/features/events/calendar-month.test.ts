import "@/shared/polyfills/temporal";

import { describe, expect, it } from "bun:test";
import {
  calendarWeeks,
  dayOf,
  monthParam,
  monthRange,
  parseMonthParam,
} from "./calendar-month";

const now = new Date("2026-11-13T10:00:00Z");

describe("parseMonthParam", () => {
  it("reads a valid month", () => {
    expect(parseMonthParam("2026-12", now).toString()).toBe("2026-12");
  });

  it("falls back to the current month in Prague", () => {
    expect(parseMonthParam(undefined, now).toString()).toBe("2026-11");
    expect(parseMonthParam("2026-13", now).toString()).toBe("2026-11");
    expect(parseMonthParam("december", now).toString()).toBe("2026-11");
    expect(parseMonthParam("9999-01", now).toString()).toBe("2026-11");
  });
});

describe("monthRange", () => {
  it("starts and ends at Prague midnight", () => {
    const { from, to } = monthRange(Temporal.PlainYearMonth.from("2026-12"));
    // Prague is UTC+1 in winter.
    expect(from.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(to.toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });
});

describe("Prague days", () => {
  it("puts a late-evening UTC time on the next Prague day", () => {
    const lateEvening = new Date("2026-11-30T23:30:00Z");
    expect(dayOf(lateEvening).toString()).toBe("2026-12-01");
    expect(monthParam(lateEvening)).toBe("2026-12");
  });
});

describe("calendarWeeks", () => {
  it("lays out Monday-first weeks of seven cells", () => {
    // 1 November 2026 is a Sunday.
    const weeks = calendarWeeks(Temporal.PlainYearMonth.from("2026-11"));
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]?.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(weeks[0]?.[6]?.toString()).toBe("2026-11-01");
    expect(weeks.at(-1)?.[0]?.toString()).toBe("2026-11-30");
    expect(weeks).toHaveLength(6);
  });
});
