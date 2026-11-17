import { describe, expect, test } from "bun:test";
import type {
  CustomerAvailability,
  CustomerMeetingRoomDuration,
  CustomerMeetingRoomStartTimes,
  CustomerMeetingRoomUnavailableDates,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Option, Result } from "effect";
import { SelectionIncomplete } from "./booking-selection";
import {
  emptyMeetingRoomDraft,
  type MeetingRoomDraft,
  meetingRoomAlternatives,
  meetingRoomAvailabilityQuery,
  meetingRoomDraftFromSelection,
  meetingRoomEnablement,
  meetingRoomStartChoices,
  meetingRoomStartTimesQuery,
  reconcileMeetingRoomDraft,
  selectMeetingRoomDate,
  selectMeetingRoomDuration,
  selectMeetingRoomStartTime,
  toMeetingRoomSelection,
} from "./meeting-room-selection";

const money = { value: 0, exponent: 2, currency: "CZK" };

const today = "2026-11-07";
/** The server's meeting-room window for `today`: six months. */
const bookableDates = { earliest: today, latest: "2027-05-07" };

const meetingRoomOffering = (
  duration: CustomerMeetingRoomDuration
): CustomerOffering => ({
  family: "meeting-room",
  duration,
  durationLabel: duration,
  name: "Meeting room",
  description: "",
  usage: "",
  facts: [],
  price: money,
  advertisedPrice: { price: money, discount: money },
  bookableDates,
});

const durations = ["hour:1", "hour:4", "day:1"] as const;
const offerings = durations.map(meetingRoomOffering);

// 10:00 in Prague (CET).
const now = new Date("2026-11-07T09:00:00Z");

const start = (
  startDateTime: string,
  startsAt: string,
  endsAt: string,
  earlySetupAvailable = true
) => ({ startDateTime, startsAt, endsAt, earlySetupAvailable });

const hourlyStarts: CustomerMeetingRoomStartTimes = {
  date: today,
  duration: "hour:1",
  startTimes: [
    start(
      "2026-11-07T10:00",
      "2026-11-07T09:00:00Z",
      "2026-11-07T10:00:00Z",
      false
    ),
    start("2026-11-07T11:00", "2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z"),
    start("2026-11-07T23:00", "2026-11-07T22:00:00Z", "2026-11-07T23:00:00Z"),
  ],
  unavailableStartTimes: [
    {
      startDateTime: "2026-11-07T12:00",
      startsAt: "2026-11-07T11:00:00Z",
      endsAt: "2026-11-07T12:00:00Z",
    },
    {
      startDateTime: "2026-11-07T07:00",
      startsAt: "2026-11-07T06:00:00Z",
      endsAt: "2026-11-07T07:00:00Z",
    },
  ],
};

const availability = (
  overrides: Partial<CustomerAvailability> = {}
): CustomerAvailability => ({
  from: today,
  to: today,
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
  ...overrides,
});

const calendar = (
  perDuration: Partial<Record<CustomerMeetingRoomDuration, Array<string>>>,
  overrides: Partial<CustomerMeetingRoomUnavailableDates> = {}
): CustomerMeetingRoomUnavailableDates => ({
  from: today,
  to: "2027-05-07",
  unavailableDates: [],
  durations: durations.map((duration) => ({
    duration,
    unavailableDates: perDuration[duration] ?? [],
  })),
  ...overrides,
});

const oneHourToday: MeetingRoomDraft = selectMeetingRoomDuration(
  selectMeetingRoomDate(emptyMeetingRoomDraft, today),
  "hour:1"
);
const at11 = selectMeetingRoomStartTime(oneHourToday, "11:00");

const enablementOf = (
  draft: MeetingRoomDraft,
  context: Partial<Parameters<typeof meetingRoomEnablement>[1]> = {}
) =>
  meetingRoomEnablement(draft, {
    now,
    startTimes: Option.some(hourlyStarts),
    availability: Option.some(availability()),
    calendar: Option.none(),
    offered: durations,
    bookableDates,
    ...context,
  });

const blockerTags = (
  draft: MeetingRoomDraft,
  context: Partial<Parameters<typeof meetingRoomEnablement>[1]> = {}
) => enablementOf(draft, context).blockers.map(({ _tag }) => _tag);

describe("opening the screen", () => {
  test("starts without a date, a length or a start", () => {
    expect(emptyMeetingRoomDraft).toEqual({
      date: Option.none(),
      duration: Option.none(),
      startTime: Option.none(),
      earlySetup: false,
    });
    expect(blockerTags(emptyMeetingRoomDraft)).toEqual(["DateRequired"]);
  });

  test("takes a booked selection's date, length, start and early setup", () => {
    expect(
      meetingRoomDraftFromSelection(
        {
          selection: {
            family: "meeting-room",
            date: "2026-11-18",
            duration: "hour:1",
            startTime: "14:00",
          },
          earlySetup: true,
        },
        offerings,
        bookableDates
      )
    ).toEqual(
      Option.some({
        date: Option.some("2026-11-18"),
        duration: Option.some("hour:1"),
        startTime: Option.some("14:00"),
        earlySetup: true,
      })
    );
  });

  test("drops a past date, a length no longer offered and a whole day's start and early setup", () => {
    expect(
      meetingRoomDraftFromSelection(
        {
          selection: {
            family: "meeting-room",
            date: "2026-11-01",
            duration: "hour:4",
            startTime: "09:00",
          },
        },
        [meetingRoomOffering("hour:1")],
        bookableDates
      )
    ).toEqual(
      Option.some({
        date: Option.none(),
        duration: Option.none(),
        startTime: Option.none(),
        earlySetup: false,
      })
    );
    expect(
      meetingRoomDraftFromSelection(
        {
          selection: {
            family: "meeting-room",
            date: "2026-11-18",
            duration: "day:1",
            startTime: "00:00",
          },
          earlySetup: true,
        },
        offerings,
        bookableDates
      ).pipe(Option.map(({ startTime, earlySetup }) => [startTime, earlySetup]))
    ).toEqual(Option.some([Option.none(), false]));
  });

  test("ignores another family's selection", () => {
    expect(
      meetingRoomDraftFromSelection(
        {
          selection: { family: "cowork", tier: "open-space", date: today },
        },
        offerings,
        bookableDates
      )
    ).toEqual(Option.none());
  });
});

describe("choosing", () => {
  test("a new date keeps the length, start and early setup", () => {
    const chosen = { ...at11, earlySetup: true };

    expect(selectMeetingRoomDate(chosen, "2026-11-09")).toEqual({
      ...chosen,
      date: Option.some("2026-11-09"),
    });
  });

  test("a whole day clears early setup", () => {
    expect(
      selectMeetingRoomDuration({ ...at11, earlySetup: true }, "day:1")
        .earlySetup
    ).toBe(false);
  });

  test("starts are read only once a date and a length are chosen", () => {
    expect(
      meetingRoomStartTimesQuery(
        selectMeetingRoomDate(emptyMeetingRoomDraft, today)
      )
    ).toEqual(Option.none());
    expect(meetingRoomStartTimesQuery(oneHourToday)).toEqual(
      Option.some({ date: today, duration: "hour:1" })
    );
  });

  test("never picks a start for the customer", () => {
    expect(
      reconcileMeetingRoomDraft(oneHourToday, Option.some(hourlyStarts), now)
        .startTime
    ).toEqual(Option.none());
  });

  test("keeps early setup only while the chosen start offers it", () => {
    const keep = { ...at11, earlySetup: true };
    const at10 = {
      ...selectMeetingRoomStartTime(oneHourToday, "10:00"),
      earlySetup: true,
    };

    expect(
      reconcileMeetingRoomDraft(keep, Option.some(hourlyStarts), now)
    ).toEqual(keep);
    expect(
      reconcileMeetingRoomDraft(at10, Option.some(hourlyStarts), now).earlySetup
    ).toBe(false);
    expect(reconcileMeetingRoomDraft(at10, Option.none(), now)).toEqual(at10);
  });
});

describe("toMeetingRoomSelection", () => {
  test("is incomplete until the date, the length and an hourly start are chosen", () => {
    expect(toMeetingRoomSelection(emptyMeetingRoomDraft)).toEqual(
      Result.fail(new SelectionIncomplete({ missing: ["date", "duration"] }))
    );
    expect(toMeetingRoomSelection(oneHourToday)).toEqual(
      Result.fail(new SelectionIncomplete({ missing: ["startTime"] }))
    );
  });

  test("names an hourly booking's start and leaves it out of a whole day", () => {
    expect(toMeetingRoomSelection(at11)).toEqual(
      Result.succeed({
        family: "meeting-room",
        date: today,
        duration: "hour:1",
        startTime: "11:00",
      })
    );
    expect(
      toMeetingRoomSelection(selectMeetingRoomDuration(at11, "day:1"))
    ).toEqual(
      Result.succeed({ family: "meeting-room", date: today, duration: "day:1" })
    );
  });
});

describe("availability queries", () => {
  test("checks the chosen start's interval once the starts load", () => {
    expect(meetingRoomAvailabilityQuery(at11, Option.none())).toEqual(
      Option.none()
    );
    expect(
      meetingRoomAvailabilityQuery(at11, Option.some(hourlyStarts))
    ).toEqual(
      Option.some({
        kind: "meeting-room",
        from: today,
        to: today,
        startsAt: "2026-11-07T10:00:00Z",
        endsAt: "2026-11-07T11:00:00Z",
      })
    );
  });

  test("keeps a booking ending at midnight on its own date", () => {
    const at23 = selectMeetingRoomStartTime(oneHourToday, "23:00");

    expect(
      Option.map(
        meetingRoomAvailabilityQuery(at23, Option.some(hourlyStarts)),
        (query) => query.to
      )
    ).toEqual(Option.some(today));
  });

  test("spans a 25-hour autumn day for a whole-day booking", () => {
    const autumnDay = selectMeetingRoomDuration(
      selectMeetingRoomDate(emptyMeetingRoomDraft, "2026-10-25"),
      "day:1"
    );
    const wholeDayStarts: CustomerMeetingRoomStartTimes = {
      date: "2026-10-25",
      duration: "day:1",
      startTimes: [
        start(
          "2026-10-25T00:00",
          "2026-10-24T22:00:00Z",
          "2026-10-25T23:00:00Z"
        ),
      ],
      unavailableStartTimes: [],
    };

    expect(
      meetingRoomAvailabilityQuery(autumnDay, Option.some(wholeDayStarts))
    ).toEqual(
      Option.some({
        kind: "meeting-room",
        from: "2026-10-25",
        to: "2026-10-25",
        startsAt: "2026-10-24T22:00:00Z",
        endsAt: "2026-10-25T23:00:00Z",
      })
    );
  });
});

describe("meetingRoomStartChoices", () => {
  test("lists free and taken starts in time order, the early and late ones apart", () => {
    const { daytime, outside } = meetingRoomStartChoices(hourlyStarts, now);

    expect(daytime).toEqual([
      { startTime: "10:00", taken: false, earlySetupAvailable: false },
      { startTime: "11:00", taken: false, earlySetupAvailable: true },
      { startTime: "12:00", taken: true, earlySetupAvailable: false },
    ]);
    // 07:00 has ended at 10:00.
    expect(outside).toEqual([
      { startTime: "23:00", taken: false, earlySetupAvailable: true },
    ]);
  });

  test("drops starts whose hour has ended", () => {
    const later = meetingRoomStartChoices(
      hourlyStarts,
      new Date("2026-11-07T10:00:00Z")
    );

    expect(later.daytime.map(({ startTime }) => startTime)).toEqual([
      "11:00",
      "12:00",
    ]);
  });
});

describe("meetingRoomAlternatives", () => {
  test("suggests the other lengths free that day and the next day this length is free", () => {
    expect(
      meetingRoomAlternatives({
        date: "2026-11-12",
        duration: "hour:4",
        calendar: calendar({
          "hour:4": ["2026-11-12", "2026-11-13"],
          "day:1": ["2026-11-12"],
        }),
        offered: durations,
        latest: "2027-05-07",
      })
    ).toEqual({ durations: ["hour:1"], nextDate: Option.some("2026-11-14") });
  });

  test("suggests nothing the calendar doesn't cover", () => {
    expect(
      meetingRoomAlternatives({
        date: "2026-11-12",
        duration: "hour:4",
        calendar: calendar(
          { "hour:4": ["2026-11-12"] },
          {
            from: "2026-11-13",
            to: "2026-11-13",
            durations: [{ duration: "hour:4", unavailableDates: [] }],
          }
        ),
        offered: durations,
        latest: "2027-05-07",
      })
    ).toEqual({ durations: [], nextDate: Option.some("2026-11-13") });
    expect(
      meetingRoomAlternatives({
        date: "2026-11-12",
        duration: "hour:4",
        calendar: calendar({}, { durations: [] }),
        offered: durations,
        latest: "2027-05-07",
      })
    ).toEqual({ durations: [], nextDate: Option.none() });
  });

  test("never suggests a day past the booking range", () => {
    expect(
      meetingRoomAlternatives({
        date: "2027-05-07",
        duration: "hour:1",
        calendar: calendar({}),
        offered: durations,
        latest: "2027-05-07",
      }).nextDate
    ).toEqual(Option.none());
  });
});

describe("meetingRoomEnablement", () => {
  test("offers today through six months without the days nothing is free", () => {
    const enablement = enablementOf(at11, {
      calendar: Option.some(calendar({}, { unavailableDates: ["2026-11-13"] })),
    });

    expect(enablement.dates).toEqual({
      earliest: today,
      latest: "2027-05-07",
      unavailable: new Set(["2026-11-13"]),
    });
    expect(enablement.earlySetupAvailable).toBe(true);
    expect(enablement.blockers).toEqual([]);
  });

  test("asks for the date, then the length, then the start", () => {
    expect(blockerTags(emptyMeetingRoomDraft)).toEqual(["DateRequired"]);
    expect(
      blockerTags(selectMeetingRoomDate(emptyMeetingRoomDraft, today))
    ).toEqual(["DurationRequired"]);
    expect(blockerTags(oneHourToday)).toEqual(["StartRequired"]);
  });

  test("waits for the starts, then for the interval's availability", () => {
    expect(blockerTags(at11, { startTimes: Option.none() })).toEqual([
      "AvailabilityPending",
    ]);
    expect(blockerTags(at11, { availability: Option.none() })).toEqual([
      "AvailabilityPending",
    ]);
  });

  test("blocks a length with no free start and says what is free instead", () => {
    const none = { ...hourlyStarts, startTimes: [] };
    const enablement = enablementOf(oneHourToday, {
      startTimes: Option.some(none),
      calendar: Option.some(calendar({ "hour:1": [today] })),
    });

    expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "NoFreeStart",
    ]);
    expect(enablement.alternatives).toEqual(
      Option.some({
        durations: ["hour:4", "day:1"],
        nextDate: Option.some("2026-11-08"),
      })
    );
    expect(enablementOf(at11).alternatives).toEqual(Option.none());
  });

  test("blocks a chosen start that is taken or whose hour has ended", () => {
    const at12 = selectMeetingRoomStartTime(oneHourToday, "12:00");
    const at10 = selectMeetingRoomStartTime(oneHourToday, "10:00");

    expect(blockerTags(at12)).toEqual(["StartUnavailable"]);
    expect(
      blockerTags(at11, {
        availability: Option.some(
          availability({ meetingRoomUnavailable: true })
        ),
      })
    ).toEqual(["StartUnavailable"]);
    expect(
      blockerTags(at10, { now: new Date("2026-11-07T09:59:00Z") })
    ).toEqual([]);
    expect(
      blockerTags(at10, { now: new Date("2026-11-07T10:00:00Z") })
    ).toEqual(["StartUnavailable"]);
  });

  test("a whole day needs no start but offers no early setup", () => {
    const wholeDay = selectMeetingRoomDuration(oneHourToday, "day:1");
    const wholeDayStarts: CustomerMeetingRoomStartTimes = {
      date: today,
      duration: "day:1",
      startTimes: [
        start(
          "2026-11-07T00:00",
          "2026-11-06T23:00:00Z",
          "2026-11-07T23:00:00Z"
        ),
      ],
      unavailableStartTimes: [],
    };
    const enablement = enablementOf(wholeDay, {
      startTimes: Option.some(wholeDayStarts),
    });

    expect(enablement.blockers).toEqual([]);
    expect(enablement.earlySetupAvailable).toBe(false);
  });

  test("blocks a date outside today through six months", () => {
    expect(blockerTags({ ...at11, date: Option.some("2027-05-08") })).toEqual([
      "DateOutOfRange",
    ]);
  });

  test("follows a shorter window the offerings give", () => {
    const shortWindow = { earliest: today, latest: "2026-11-20" };
    const enablement = enablementOf(
      { ...at11, date: Option.some("2026-11-21") },
      { bookableDates: shortWindow }
    );

    expect(enablement.dates).toMatchObject(shortWindow);
    expect(enablement.blockers.map(({ _tag }) => _tag)).toContain(
      "DateOutOfRange"
    );
  });
});
