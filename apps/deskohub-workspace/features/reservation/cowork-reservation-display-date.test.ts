import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { formatCoworkReservationDisplayDate } from "./cowork-reservation-display-date";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateTimeRange,
} from "./reservation-date";

const pragueInstant = (dateTime: string) =>
  Temporal.ZonedDateTime.from(`${dateTime}[Europe/Prague]`).toInstant();

const overnight = {
  startsAt: pragueInstant("2099-06-10T12:00"),
  endsAt: pragueInstant("2099-06-11T12:00"),
};
const day = {
  startsAt: pragueInstant("2099-06-10T00:00"),
  endsAt: pragueInstant("2099-06-11T00:00"),
};

describe("formatCoworkReservationDisplayDate", () => {
  test("shows an overnight Reserved Desk stay as its start and end date-times", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      expect(
        formatCoworkReservationDisplayDate(
          { tier: "reserved-desk", interval: overnight },
          locale
        )
      ).toBe(
        formatReservationDisplayDateTimeRange(
          overnight.startsAt,
          overnight.endsAt,
          locale
        )
      );
    }
  });

  test("shows a day stay, and any other tier, as its arrival date", () => {
    expect(
      formatCoworkReservationDisplayDate(
        { tier: "reserved-desk", interval: day },
        "en-US"
      )
    ).toBe(formatReservationDisplayDate(day.startsAt, "en-US"));
    expect(
      formatCoworkReservationDisplayDate(
        { tier: "open-space", interval: overnight },
        "en-US"
      )
    ).toBe(formatReservationDisplayDate(overnight.startsAt, "en-US"));
  });
});
