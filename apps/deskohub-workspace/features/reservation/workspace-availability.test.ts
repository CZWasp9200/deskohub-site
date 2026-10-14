import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { getCurrentWorkspaceDate } from "./reservation-date";
import {
  getCoworkAvailabilityQueries,
  getMeetingRoomAvailabilityQuery,
  getMeetingRoomSelectionAvailabilityQuery,
  getOfficeAvailabilityQuery,
  getWorkspaceAvailabilityRange,
  isCoworkOfferAvailable,
  isMeetingRoomAvailable,
  parseWorkspaceAvailabilityQuery,
} from "./workspace-availability";

describe("parseWorkspaceAvailabilityQuery", () => {
  test("keeps the public kind query param as the domain discriminator", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({
        kind: "meeting-room",
        from: "2099-06-10",
        to: "2099-06-10",
      })
    );

    expect(query).toMatchObject({
      kind: "meeting-room",
      from: "2099-06-10",
      to: "2099-06-10",
    });
    expect(query).not.toHaveProperty("date");
  });

  test("parses office interval and seat availability fields", () => {
    expect(
      parseWorkspaceAvailabilityQuery(
        new URLSearchParams({
          kind: "office",
          from: "2099-06-10",
          to: "2099-06-12",
          startsAt: "2099-06-09T22:00:00Z",
          endsAt: "2099-06-12T22:00:00Z",
          seats: "3",
        })
      )
    ).toEqual({
      kind: "office",
      from: "2099-06-10",
      to: "2099-06-12",
      startsAt: "2099-06-09T22:00:00Z",
      endsAt: "2099-06-12T22:00:00Z",
      seats: 3,
    });
  });

  test.each(["0", "-1", "1.5", "invalid"])(
    "drops an invalid office seat count of %s",
    (seats) => {
      const query = parseWorkspaceAvailabilityQuery(
        new URLSearchParams({
          kind: "office",
          from: "2099-06-10",
          to: "2099-06-12",
          seats,
        })
      );

      expect(query).not.toHaveProperty("seats");
    }
  );

  test("drops interval fields from cowork availability queries", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({
        kind: "cowork",
        date: "2099-06-10",
        from: "2099-06-10",
        to: "2099-06-10",
        startsAt: "10:00",
        endsAt: "11:00",
      })
    );

    expect(query).toEqual({
      kind: "cowork",
      date: "2099-06-10",
      from: "2099-06-10",
      to: "2099-06-10",
    });
  });
});

describe("isCoworkOfferAvailable", () => {
  const available = {
    reservedDeskWorkstationRequiredDates: [],
    unavailableCoworkTiers: [],
    unavailableDates: [],
    unavailableMonitorOptions: [],
  };

  test("accepts an offer nothing blocks", () => {
    expect(
      isCoworkOfferAvailable(available, {
        date: "2099-06-10",
        entryTier: "reserved-desk",
        monitorOption: "2x27-qhd",
      })
    ).toBe(true);
  });

  test("rejects an unavailable tier, monitor, or date", () => {
    const offer = {
      date: "2099-06-10",
      entryTier: "reserved-desk",
      monitorOption: "2x27-qhd",
    } as const;

    expect(
      isCoworkOfferAvailable(
        { ...available, unavailableCoworkTiers: ["reserved-desk"] },
        offer
      )
    ).toBe(false);
    expect(
      isCoworkOfferAvailable(
        { ...available, unavailableMonitorOptions: ["2x27-qhd"] },
        offer
      )
    ).toBe(false);
    expect(
      isCoworkOfferAvailable(
        { ...available, unavailableDates: ["2099-06-10"] },
        { date: "2099-06-10", entryTier: "open-space" }
      )
    ).toBe(false);
  });

  test("keeps a Reserved Desk on a date that only requires a workstation", () => {
    const availability = {
      ...available,
      reservedDeskWorkstationRequiredDates: ["2099-06-10"],
      unavailableDates: ["2099-06-10"],
    };

    expect(
      isCoworkOfferAvailable(availability, {
        date: "2099-06-10",
        entryTier: "reserved-desk",
      })
    ).toBe(true);
    expect(
      isCoworkOfferAvailable(availability, {
        date: "2099-06-10",
        entryTier: "open-space",
      })
    ).toBe(false);
  });
});

describe("meeting-room availability", () => {
  test("queries the interval's service dates and bounds", () => {
    expect(
      getMeetingRoomAvailabilityQuery({
        startsAt: "2099-06-09T22:00:00Z",
        endsAt: "2099-06-10T22:00:00Z",
      })
    ).toEqual({
      kind: "meeting-room",
      from: "2099-06-10",
      to: "2099-06-10",
      startsAt: "2099-06-09T22:00:00Z",
      endsAt: "2099-06-10T22:00:00Z",
    });
  });

  test("queries the selected start and duration's interval", () => {
    expect(
      getMeetingRoomSelectionAvailabilityQuery({
        duration: "hour:4",
        startDateTime: "2099-07-30T15:00",
      })
    ).toEqual({
      kind: "meeting-room",
      from: "2099-07-30",
      to: "2099-07-30",
      startsAt: "2099-07-30T13:00:00Z",
      endsAt: "2099-07-30T17:00:00Z",
    });
  });

  test("treats a blocked date or a taken room as unavailable", () => {
    const free = { meetingRoomUnavailable: false, unavailableDates: [] };

    expect(isMeetingRoomAvailable(free)).toBe(true);
    expect(
      isMeetingRoomAvailable({ ...free, meetingRoomUnavailable: true })
    ).toBe(false);
    expect(
      isMeetingRoomAvailable({ ...free, unavailableDates: ["2099-06-10"] })
    ).toBe(false);
  });
});

describe("workspace availability ranges", () => {
  // 22:30 UTC is already the next day in Prague (CEST, UTC+2).
  const beforeUtcMidnight = Temporal.Instant.from("2099-07-30T22:30:00Z");

  test("spans six months from the Prague workspace date", () => {
    const today = getCurrentWorkspaceDate(beforeUtcMidnight).toString();

    expect(today).toBe("2099-07-31");
    expect(getWorkspaceAvailabilityRange(today)).toEqual({
      from: "2099-07-31",
      to: "2100-01-31",
    });
  });

  test("matches the default range the availability route parses", () => {
    const today = getCurrentWorkspaceDate(beforeUtcMidnight).toString();
    const parsed = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({ entryTier: "reserved-desk" }),
      new Date(beforeUtcMidnight.epochMilliseconds)
    );

    expect(
      getCoworkAvailabilityQueries({ today, entryTier: "reserved-desk" })
    ).toEqual({ range: parsed });
  });
});

describe("getCoworkAvailabilityQueries", () => {
  const today = "2099-07-30";
  const range = { from: "2099-07-30", to: "2100-01-30" };

  test("asks for the tier's calendar range and the selected day alone", () => {
    expect(
      getCoworkAvailabilityQueries({
        today,
        entryTier: "open-space",
        date: "2099-08-02",
        monitorOption: "2x27-qhd",
      })
    ).toEqual({
      range: { kind: "cowork", ...range, entryTier: "open-space" },
      selection: {
        kind: "cowork",
        from: "2099-08-02",
        to: "2099-08-02",
        entryTier: "open-space",
        date: "2099-08-02",
      },
    });
  });

  test("adds the monitor and the bare workstation requirement for a Reserved Desk", () => {
    const bare = {
      kind: "cowork" as const,
      from: "2099-08-02",
      to: "2099-08-02",
      entryTier: "reserved-desk" as const,
      date: "2099-08-02",
    };

    expect(
      getCoworkAvailabilityQueries({
        today,
        entryTier: "reserved-desk",
        date: "2099-08-02",
        monitorOption: "2x32-qhd",
      })
    ).toEqual({
      range: { kind: "cowork", ...range, entryTier: "reserved-desk" },
      selection: { ...bare, monitorOption: "2x32-qhd" },
      workstationRequirement: bare,
    });
  });
});

describe("getOfficeAvailabilityQuery", () => {
  test("spans the office booking horizon from the workspace date", () => {
    expect(getOfficeAvailabilityQuery("2099-07-31")).toEqual({
      kind: "office",
      from: "2099-07-31",
      to: "2099-08-31",
    });
  });
});
