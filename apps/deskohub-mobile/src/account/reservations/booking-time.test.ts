import { describe, expect, test } from "bun:test";
import { DateTime, Option } from "effect";
import { bookingCountdown, dateTileParts } from "./booking-time";

const at = (iso: string) => DateTime.makeUnsafe(iso);
// Thursday 26 November 2026, 00:00 to 17:00 in Prague (UTC+1).
const start = at("2026-11-25T23:00:00Z");
const end = at("2026-11-26T16:00:00Z");

describe("bookingCountdown", () => {
  test("counts Prague calendar days, not 24-hour spans", () => {
    // 10 November 23:30 Prague is still 10 November: 16 days to go.
    expect(bookingCountdown(at("2026-11-10T22:30:00Z"), start, end)).toEqual(
      Option.some({ kind: "days", days: 16 })
    );
    // 25 November 00:30 Prague: tomorrow, though more than 24 hours ahead.
    expect(bookingCountdown(at("2026-11-24T23:30:00Z"), start, end)).toEqual(
      Option.some({ kind: "tomorrow" })
    );
  });

  test("reads today before the start, and open while it runs", () => {
    const afternoon = at("2026-11-26T13:00:00Z");
    const evening = at("2026-11-26T17:00:00Z");
    expect(
      bookingCountdown(at("2026-11-26T06:00:00Z"), afternoon, evening)
    ).toEqual(Option.some({ kind: "today" }));
    expect(bookingCountdown(at("2026-11-26T10:00:00Z"), start, end)).toEqual(
      Option.some({ kind: "open-now" })
    );
  });

  test("an ended booking has no countdown; its end is exclusive", () => {
    expect(bookingCountdown(end, start, end)).toEqual(Option.none());
  });
});

describe("dateTileParts", () => {
  test("reads the Prague day, whatever the UTC date", () => {
    // 23:00 UTC on the 25th is already the 26th in Prague.
    const parts = dateTileParts(start, "en-US");
    expect(parts.day).toBe("26");
    expect(parts).toEqual(dateTileParts(at("2026-11-26T12:00:00Z"), "en-US"));
    expect(parts).not.toEqual(
      dateTileParts(at("2026-11-25T12:00:00Z"), "en-US")
    );
  });
});
