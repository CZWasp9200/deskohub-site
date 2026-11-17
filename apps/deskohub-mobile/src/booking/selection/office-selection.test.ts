import { describe, expect, test } from "bun:test";
import type { CustomerAvailability } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import {
  clampOfficeDraft,
  emptyOfficeDraft,
  maximumOfficeDayCount,
  type OfficeDraft,
  type OfficeOffering,
  officeAvailabilityQuery,
  officeDraftFromSelection,
  officeEnablement,
  selectOfficeDate,
  toOfficeSelection,
} from "./office-selection";

const money = { value: 0, exponent: 2, currency: "CZK" };

const today = "2026-11-07";
/** The server's office window for `today`: one month. */
const bookableDates = { earliest: today, latest: "2026-12-07" };

const offering: OfficeOffering = {
  family: "office",
  name: "Office",
  description: "",
  usage: "",
  price: money,
  seatPrice: money,
  maximumSeats: 6,
  maximumDurationHours: 672,
  advertisedPrice: { price: money, discount: money },
  bookableDates,
};

const availability = (
  overrides: Partial<CustomerAvailability> = {}
): CustomerAvailability => ({
  from: today,
  to: "2026-12-07",
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
  ...overrides,
});

const enablementOf = (
  draft: OfficeDraft,
  overrides: Partial<CustomerAvailability> = {},
  officeOffering: OfficeOffering = offering
) =>
  officeEnablement(draft, {
    offering: officeOffering,
    availability: Option.some(availability(overrides)),
  });

/** One day from `date` with one seat. */
const oneDayOn = (date: string): OfficeDraft =>
  selectOfficeDate(emptyOfficeDraft, date);

const blockerTags = (
  draft: OfficeDraft,
  overrides: Partial<CustomerAvailability> = {}
) => enablementOf(draft, overrides).blockers.map(({ _tag }) => _tag);

describe("emptyOfficeDraft", () => {
  test("opens with no first day, one day and one seat", () => {
    expect(emptyOfficeDraft).toEqual({
      date: Option.none(),
      dayCount: 1,
      seats: 1,
    });
  });
});

describe("toOfficeSelection", () => {
  test("ends on the last day booked, inclusive", () => {
    expect(
      toOfficeSelection({ date: Option.some(today), dayCount: 3, seats: 2 })
    ).toEqual(
      Option.some({
        family: "office",
        date: today,
        endDate: "2026-11-09",
        seats: 2,
      })
    );
    expect(
      Option.map(toOfficeSelection(oneDayOn(today)), ({ endDate }) => endDate)
    ).toEqual(Option.some(today));
  });

  test("names no booking before a first day is picked", () => {
    expect(toOfficeSelection(emptyOfficeDraft)).toEqual(Option.none());
  });
});

describe("officeDraftFromSelection", () => {
  const booked = {
    family: "office",
    date: "2026-11-10",
    endDate: "2026-11-12",
    seats: 4,
  } as const;

  test("opens a booked stay on its first day, days and seats", () => {
    expect(officeDraftFromSelection(booked, bookableDates)).toEqual(
      Option.some({ date: Option.some("2026-11-10"), dayCount: 3, seats: 4 })
    );
  });

  test("drops a first day the calendar no longer offers, keeping days and seats", () => {
    expect(
      officeDraftFromSelection(booked, {
        earliest: "2026-11-11",
        latest: "2026-12-11",
      }).pipe(
        Option.map(({ date, dayCount, seats }) => ({ date, dayCount, seats }))
      )
    ).toEqual(Option.some({ date: Option.none(), dayCount: 3, seats: 4 }));
    expect(
      Option.map(
        officeDraftFromSelection(
          { ...booked, date: "2026-12-08" },
          bookableDates
        ),
        ({ date }) => date
      )
    ).toEqual(Option.some(Option.none()));
  });

  test("ignores another family's selection", () => {
    expect(
      officeDraftFromSelection(
        { family: "cowork", date: today, tier: "open-space" },
        bookableDates
      )
    ).toEqual(Option.none());
  });
});

describe("officeAvailabilityQuery", () => {
  test("spans the office offering's bookable dates", () => {
    expect(
      officeAvailabilityQuery({ earliest: today, latest: "2026-11-20" })
    ).toEqual({ kind: "office", from: today, to: "2026-11-20" });
  });
});

describe("maximumOfficeDayCount", () => {
  const limits = { maximumDurationHours: 672, unavailableDates: [] };

  test("reaches the horizon's last day when 672 hours allow it", () => {
    // 7 November to 7 December is 31 days, but 672 hours cap it at 28.
    expect(
      maximumOfficeDayCount({ ...limits, date: today, latest: "2026-12-07" })
    ).toBe(28);
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: "2026-12-01",
        latest: "2026-12-07",
      })
    ).toBe(7);
  });

  test("allows only 27 days across the autumn clock change", () => {
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: "2026-10-01",
        latest: "2026-11-01",
      })
    ).toBe(27);
  });

  test("allows 28 days across the spring clock change", () => {
    // 28 days with a 23-hour day are 671 hours; a 29th would be 695.
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: "2026-03-15",
        latest: "2026-04-15",
      })
    ).toBe(28);
  });

  test("stops before the first unavailable day", () => {
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: today,
        latest: "2026-12-07",
        unavailableDates: ["2026-11-20", "2026-11-11", "2026-11-01"],
      })
    ).toBe(4);
  });

  test("allows none from an unavailable day", () => {
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: today,
        latest: "2026-12-07",
        unavailableDates: [today],
      })
    ).toBe(0);
  });
});

describe("officeEnablement", () => {
  test("offers the offering's bookable dates and the office's seats", () => {
    const enablement = enablementOf(oneDayOn(today), {
      unavailableDates: ["2026-11-20"],
    });

    expect(enablement.dates).toEqual({
      earliest: today,
      latest: "2026-12-07",
      unavailable: new Set(["2026-11-20"]),
    });
    expect(enablement.maximumDayCount).toBe(13);
    expect(enablement.maximumSeats).toEqual(Option.some(6));
    expect(enablement.blockers).toEqual([]);
  });

  test("follows a shorter window the offering gives, which caps the stay", () => {
    const shortWindow: OfficeOffering = {
      ...offering,
      bookableDates: { earliest: today, latest: "2026-11-12" },
    };

    expect(enablementOf(oneDayOn(today), {}, shortWindow)).toMatchObject({
      dates: { earliest: today, latest: "2026-11-12" },
      maximumDayCount: 6,
    });
    expect(
      enablementOf(oneDayOn("2026-11-13"), {}, shortWindow).maximumDayCount
    ).toBe(0);
  });

  test("keeps the drafted seats while the capacity can't be read", () => {
    const { maximumSeats: _, ...withoutCapacity } = offering;
    const group = { date: Option.some(today), dayCount: 1, seats: 4 };
    const enablement = enablementOf(group, {}, withoutCapacity);

    expect(enablement.maximumSeats).toEqual(Option.none());
    expect(enablement.blockers).toEqual([]);
    expect(clampOfficeDraft(group, enablement)).toBe(group);
  });

  test("blocks counts that aren't whole numbers", () => {
    expect(
      blockerTags({ date: Option.some(today), dayCount: 1.5, seats: 1 })
    ).toEqual(["DayCountUnavailable"]);
    expect(
      blockerTags({ date: Option.some(today), dayCount: 1, seats: 2.5 })
    ).toEqual(["SeatsUnavailable"]);
  });

  test("blocks an unavailable or out-of-horizon first day", () => {
    expect(blockerTags(oneDayOn(today), { unavailableDates: [today] })).toEqual(
      ["DateUnavailable"]
    );
    expect(blockerTags(oneDayOn("2026-12-08"))).toEqual(["DateUnavailable"]);
    expect(blockerTags(oneDayOn("2026-11-06"))).toEqual(["DateUnavailable"]);
  });

  test("blocks a stay past the first unavailable day", () => {
    const enablement = enablementOf(
      { date: Option.some(today), dayCount: 5, seats: 1 },
      { unavailableDates: ["2026-11-11"] }
    );

    expect(enablement.blockers).toEqual([
      { _tag: "DayCountUnavailable", maximumDayCount: 4 },
    ]);
  });

  test("blocks more seats than the office has", () => {
    expect(
      blockerTags({ date: Option.some(today), dayCount: 1, seats: 7 })
    ).toEqual(["SeatsUnavailable"]);
    expect(
      blockerTags({ date: Option.some(today), dayCount: 1, seats: 0 })
    ).toEqual(["SeatsUnavailable"]);
  });

  test("asks for a first day before anything else", () => {
    const enablement = enablementOf(emptyOfficeDraft);

    expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "DateRequired",
    ]);
    expect(enablement.maximumDayCount).toBe(0);
    expect(enablement.notices).toEqual([]);
  });

  test("waits for the horizon's availability", () => {
    const enablement = officeEnablement(oneDayOn(today), {
      offering,
      availability: Option.none(),
    });

    expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);
  });

  test("shows the notices within the days drafted", () => {
    const notice = { date: "2026-11-08", startsAt: "", endsAt: "" };
    const enablement = enablementOf(
      { date: Option.some(today), dayCount: 2, seats: 1 },
      { notices: [notice, { ...notice, date: "2026-11-09" }] }
    );

    expect(enablement.notices).toEqual([notice]);
  });
});

describe("clampOfficeDraft", () => {
  test("brings days and seats within what the first day allows", () => {
    expect(
      clampOfficeDraft(
        { date: Option.some(today), dayCount: 10, seats: 9 },
        { maximumDayCount: 4, maximumSeats: Option.some(6) }
      )
    ).toEqual({ date: Option.some(today), dayCount: 4, seats: 6 });
  });

  test("rounds fractional counts down to whole ones", () => {
    expect(
      clampOfficeDraft(
        { date: Option.some(today), dayCount: 2.7, seats: 0.4 },
        { maximumDayCount: 4, maximumSeats: Option.some(6) }
      )
    ).toEqual({ date: Option.some(today), dayCount: 2, seats: 1 });
  });

  test("keeps a draft already within bounds", () => {
    const draft = { date: Option.some(today), dayCount: 3, seats: 2 };

    expect(
      clampOfficeDraft(draft, {
        maximumDayCount: 4,
        maximumSeats: Option.some(6),
      })
    ).toBe(draft);
  });

  test("keeps the day count when the first day allows none", () => {
    const draft = { date: Option.some(today), dayCount: 3, seats: 2 };

    expect(
      clampOfficeDraft(draft, {
        maximumDayCount: 0,
        maximumSeats: Option.some(6),
      }).dayCount
    ).toBe(3);
  });
});
