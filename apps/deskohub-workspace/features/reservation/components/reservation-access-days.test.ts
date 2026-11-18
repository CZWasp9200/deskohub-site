import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  formatReservationAccessDay,
  getReservationAccessDays,
} from "./reservation-access-days";

const pragueMidnight = (date: string) =>
  Temporal.PlainDate.from(date).toZonedDateTime("Europe/Prague").toInstant();

describe("getReservationAccessDays", () => {
  test("reads one whole day as its first and last day", () => {
    expect(
      getReservationAccessDays(
        pragueMidnight("2026-11-18"),
        pragueMidnight("2026-11-19")
      ).pipe(
        Option.map(({ firstDay, lastDay }) => [firstDay, lastDay].map(String))
      )
    ).toEqual(Option.some(["2026-11-18", "2026-11-18"]));
  });

  test("reads several whole days up to the day before the end", () => {
    expect(
      getReservationAccessDays(
        pragueMidnight("2026-11-18"),
        pragueMidnight("2026-11-21")
      ).pipe(
        Option.map(({ firstDay, lastDay }) => [firstDay, lastDay].map(String))
      )
    ).toEqual(Option.some(["2026-11-18", "2026-11-20"]));
  });

  test("reads whole days across a daylight-saving change", () => {
    expect(
      getReservationAccessDays(
        pragueMidnight("2026-10-24"),
        pragueMidnight("2026-10-26")
      ).pipe(Option.map(({ lastDay }) => lastDay.toString()))
    ).toEqual(Option.some("2026-10-25"));
  });

  test("keeps access that starts or ends during a day as times", () => {
    const start = Temporal.Instant.from("2026-11-18T08:00:00Z");

    expect(
      getReservationAccessDays(start, pragueMidnight("2026-11-19"))
    ).toEqual(Option.none());
    expect(
      getReservationAccessDays(
        pragueMidnight("2026-11-18"),
        Temporal.Instant.from("2026-11-18T16:00:00Z")
      )
    ).toEqual(Option.none());
  });
});

describe("formatReservationAccessDay", () => {
  test("writes the day in numbers without a time", () => {
    const day = Temporal.PlainDate.from("2026-11-18");

    expect(formatReservationAccessDay(day, "en-US")).toBe("11/18/2026");
    expect(formatReservationAccessDay(day, "cs-CZ")).not.toContain(":");
  });
});
