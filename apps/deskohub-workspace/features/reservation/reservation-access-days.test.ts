import { describe, expect, test } from "bun:test";
import { getReservationAccessDays } from "./reservation-access-days";

const window = (startsAt: string, endsAt: string) => ({
  accessStartsAt: Temporal.Instant.from(startsAt),
  accessEndsAt: Temporal.Instant.from(endsAt),
});

describe("getReservationAccessDays", () => {
  test("names the Prague days of a whole-day window", () => {
    expect(
      getReservationAccessDays(
        window("2026-11-17T23:00:00Z", "2026-11-18T23:00:00Z")
      )
    ).toEqual({ from: "2026-11-18", through: "2026-11-18" });
    expect(
      getReservationAccessDays(
        window("2026-11-17T23:00:00Z", "2026-11-20T23:00:00Z")
      )
    ).toEqual({ from: "2026-11-18", through: "2026-11-20" });
  });

  test("names none for a window within a day", () => {
    expect(
      getReservationAccessDays(
        window("2026-11-18T08:00:00Z", "2026-11-18T16:00:00Z")
      )
    ).toBeUndefined();
  });
});
