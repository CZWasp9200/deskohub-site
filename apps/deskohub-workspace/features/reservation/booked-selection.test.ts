import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { getBookedSelection } from "@/features/reservation/booked-selection";
import { getMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const pragueInstant = (local: string) =>
  Temporal.PlainDateTime.from(local)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

const booked = { seats: Option.some(1) };

describe("getBookedSelection", () => {
  test("reopens a current cowork tier on its Prague date with its add-ons", () => {
    expect(
      getBookedSelection({
        details: { kind: "cowork", entryTier: "open-space", coffee: true },
        booked,
        timing: {
          // Midnight in Prague is still the previous day in UTC.
          reservedFrom: pragueInstant("2099-07-31T00:00"),
          reservedUntil: pragueInstant("2099-07-31T17:00"),
        },
      })
    ).toEqual({
      kind: "cowork",
      entryTier: "open-space",
      date: "2099-07-31",
      coffee: true,
      monitorOption: undefined,
    });
  });

  test("reopens nothing for a retired cowork tier", () => {
    expect(
      getBookedSelection({
        details: { kind: "cowork", entryTier: "basic", coffee: false },
        booked,
        timing: {
          reservedFrom: pragueInstant("2099-07-31T08:00"),
          reservedUntil: pragueInstant("2099-07-31T17:00"),
        },
      })
    ).toBeUndefined();
  });

  test("reopens a meeting room on its booked start with its early setup", () => {
    expect(
      getBookedSelection({
        details: {
          kind: "meeting-room",
          duration: getMeetingRoomReservationDuration("hour:4"),
          earlySetup: true,
        },
        booked,
        timing: {
          reservedFrom: pragueInstant("2099-07-31T09:00"),
          reservedUntil: pragueInstant("2099-07-31T13:00"),
        },
      })
    ).toEqual({
      kind: "meeting-room",
      startDateTime: "2099-07-31T09:00",
      duration: "hour:4",
      earlySetup: true,
    });
  });

  test("takes a meeting room's duration from its interval when the row recorded none", () => {
    expect(
      getBookedSelection({
        details: { kind: "meeting-room" },
        booked,
        timing: {
          reservedFrom: pragueInstant("2099-07-31T09:00"),
          reservedUntil: pragueInstant("2099-07-31T10:00"),
        },
      })
    ).toMatchObject({ kind: "meeting-room", duration: "hour:1" });
  });

  test("reopens an office's whole days with the seats Dotypos holds, else the stored ones", () => {
    const office = {
      details: { kind: "office", seats: 2, dayCount: 3 },
      timing: {
        reservedFrom: pragueInstant("2099-07-31T00:00"),
        reservedUntil: pragueInstant("2099-08-03T00:00"),
      },
    } as const;

    expect(
      getBookedSelection({ ...office, booked: { seats: Option.some(4) } })
    ).toEqual({
      kind: "office",
      startsOn: "2099-07-31",
      dayCount: 3,
      seats: 4,
    });
    expect(
      getBookedSelection({ ...office, booked: { seats: Option.none() } })
    ).toMatchObject({ kind: "office", seats: 2 });
    expect(
      getBookedSelection({
        details: { kind: "office" },
        booked: { seats: Option.none() },
        timing: office.timing,
      })
    ).toBeUndefined();
  });
});
