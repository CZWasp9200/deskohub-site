import { describe, expect, test } from "bun:test";
import {
  getReservationAccessName,
  getRestoredReservationAccess,
  reservationAccessGrantStates,
} from "./reservation-access";

describe("getReservationAccessName", () => {
  test("returns the stored name of a grant's Igloohome credential", () => {
    expect(
      getReservationAccessName({
        reservationId: "reservation-1",
        accessName: "Deskohub stored-name",
      })
    ).toBe("Deskohub stored-name");
  });

  test("names a grant created before names were stored by its reservation within Igloohome's limit", () => {
    const reservationId = `reservation-${"x".repeat(80)}`;

    expect(getReservationAccessName({ reservationId, accessName: null })).toBe(
      `Deskohub ${reservationId}`.slice(0, 60)
    );
  });
});

describe("getRestoredReservationAccess", () => {
  const reservedUntil = Temporal.Instant.from("2099-06-10T17:00:00Z");
  const beforeEnd = Temporal.Instant.from("2099-06-10T16:59:59Z");

  test.each([
    { state: "expired", access: "issue" },
    { state: "pending", access: "uncertain" },
    { state: "failed", access: "uncertain" },
    { state: "issued", access: "uncertain" },
    { state: "provisioning", access: "uncertain" },
    { state: "uncertain", access: "uncertain" },
  ] as const)(
    "plans $access for a $state grant of a reservation that hasn't ended",
    ({ state, access }) => {
      expect(
        getRestoredReservationAccess({ state }, { reservedUntil }, beforeEnd)
      ).toBe(access);
    }
  );

  test("issues access for a reservation that hasn't ended and has no grant", () => {
    expect(
      getRestoredReservationAccess(null, { reservedUntil }, beforeEnd)
    ).toBe("issue");
  });

  test("leaves every grant of a reservation that has ended", () => {
    for (const now of [reservedUntil, reservedUntil.add({ hours: 1 })]) {
      expect(getRestoredReservationAccess(null, { reservedUntil }, now)).toBe(
        "not_needed"
      );
      for (const state of reservationAccessGrantStates) {
        expect(
          getRestoredReservationAccess({ state }, { reservedUntil }, now)
        ).toBe("not_needed");
      }
    }
  });
});
