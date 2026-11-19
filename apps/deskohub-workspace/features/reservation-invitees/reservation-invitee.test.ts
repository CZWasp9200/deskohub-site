import { describe, expect, test } from "bun:test";
import { getReservationInviteeRetainUntil } from "./reservation-invitee";

describe("getReservationInviteeRetainUntil", () => {
  test("keeps the address for 30 days after the end of the last day in Prague", () => {
    expect(
      getReservationInviteeRetainUntil(
        Temporal.Instant.from("2026-11-20T23:00:00Z")
      ).toString()
    ).toBe("2026-12-20T23:00:00Z");
  });

  test("counts calendar days across a daylight saving change", () => {
    // Prague midnight after 2027-03-27 is 23:00Z; 30 Prague days later
    // summer time has started, so midnight is 22:00Z.
    expect(
      getReservationInviteeRetainUntil(
        Temporal.Instant.from("2027-03-27T23:00:00Z")
      ).toString()
    ).toBe("2027-04-26T22:00:00Z");
  });
});
