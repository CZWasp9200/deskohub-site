import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import type { DateChoice } from "../selection/booking-selection";
import type { PragueDate } from "../selection/prague-date";
import {
  type CalendarDayState,
  initialCalendarMonth,
  monthCalendarModel,
} from "./month-calendar-model";

const dateChoice = (
  earliest: PragueDate,
  latest: PragueDate,
  unavailable: ReadonlyArray<PragueDate> = []
): DateChoice => ({ earliest, latest, unavailable: new Set(unavailable) });

const statesByDate = (model: ReturnType<typeof monthCalendarModel>) =>
  new Map(
    model.weeks
      .flat()
      .flatMap((cell) => Option.toArray(cell))
      .map((day) => [day.date, day.state] as const)
  );

describe("initialCalendarMonth", () => {
  const dates = dateChoice("2026-11-07", "2027-02-06");

  test.each([
    ["the selected date's month", "2027-01-15", { year: 2027, month: 1 }],
    [
      "the earliest date's month without a selection",
      undefined,
      { year: 2026, month: 11 },
    ],
    [
      "the earliest month for a selection before it",
      "2026-09-01",
      { year: 2026, month: 11 },
    ],
    [
      "the latest month for a selection after it",
      "2027-05-01",
      { year: 2027, month: 2 },
    ],
  ] as const)("is %s", (_, selected, expected) => {
    expect(initialCalendarMonth(dates, selected)).toEqual(expected);
  });
});

describe("monthCalendarModel", () => {
  test("marks days before the earliest as past and after the latest as outside the range", () => {
    const states = statesByDate(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-07", "2026-11-20"),
        selected: undefined,
      })
    );

    expect(states.get("2026-11-06")).toBe("past");
    expect(states.get("2026-11-07")).toBe("available");
    expect(states.get("2026-11-20")).toBe("available");
    expect(states.get("2026-11-21")).toBe("outside-range");
  });

  test.each<
    readonly [string, PragueDate, PragueDate | undefined, CalendarDayState]
  >([
    ["an unavailable day", "2026-11-12", undefined, "unavailable"],
    ["the selected day", "2026-11-10", "2026-11-10", "selected"],
    [
      "a selected day that is unavailable",
      "2026-11-12",
      "2026-11-12",
      "unavailable",
    ],
    [
      "a selected day outside the range",
      "2026-11-30",
      "2026-11-30",
      "outside-range",
    ],
    ["a selected day in the past", "2026-11-03", "2026-11-03", "past"],
  ])("gives %s its state", (_, date, selected, expected) => {
    const states = statesByDate(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-07", "2026-11-20", ["2026-11-12"]),
        selected,
      })
    );

    expect(states.get(date)).toBe(expected);
  });

  test("selects no day without a selection", () => {
    const states = statesByDate(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-10", "2026-11-30", ["2026-11-20"]),
        selected: undefined,
        today: "2026-11-10",
      })
    );

    expect([...states.values()]).not.toContain("selected");
  });

  test("selects only the selected day", () => {
    const states = statesByDate(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-01", "2026-11-30"),
        selected: "2026-11-10",
      })
    );

    expect(
      [...states.values()].filter((state) => state === "selected")
    ).toHaveLength(1);
  });

  test.each([
    ["first", { year: 2026, month: 12 }, false, true],
    ["last", { year: 2027, month: 1 }, true, false],
  ] as const)(
    "pages only into the range's months from its %s month across a year boundary",
    (_, month, canGoPrevious, canGoNext) => {
      const model = monthCalendarModel({
        month,
        dates: dateChoice("2026-12-20", "2027-01-10"),
        selected: undefined,
      });

      expect(model.month).toEqual(month);
      expect(model.canGoPrevious).toBe(canGoPrevious);
      expect(model.canGoNext).toBe(canGoNext);
    }
  );

  test("pages neither way when the range fits in one month", () => {
    const model = monthCalendarModel({
      month: { year: 2026, month: 11 },
      dates: dateChoice("2026-11-07", "2026-11-20"),
      selected: undefined,
    });

    expect([model.canGoPrevious, model.canGoNext]).toEqual([false, false]);
  });

  test.each([
    ["before", { year: 2026, month: 6 }, { year: 2026, month: 12 }],
    ["after", { year: 2027, month: 4 }, { year: 2027, month: 1 }],
  ] as const)(
    "shows the nearest range month for a month %s the range",
    (_, month, expected) => {
      const model = monthCalendarModel({
        month,
        dates: dateChoice("2026-12-20", "2027-01-10"),
        selected: undefined,
      });

      expect(model.month).toEqual(expected);
    }
  );

  test("starts a month whose first day is a Sunday in the last column", () => {
    // 1 February 2026 is a Sunday.
    const { weeks } = monthCalendarModel({
      month: { year: 2026, month: 2 },
      dates: dateChoice("2026-02-01", "2026-02-28"),
      selected: undefined,
    });
    const [firstWeek = []] = weeks;

    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(firstWeek.slice(0, 6).every(Option.isNone)).toBe(true);
    expect(Option.getOrUndefined(firstWeek[6] ?? Option.none())).toMatchObject({
      date: "2026-02-01",
      day: 1,
      state: "available",
    });
  });

  test("numbers the days of the month in order", () => {
    const { weeks } = monthCalendarModel({
      month: { year: 2026, month: 2 },
      dates: dateChoice("2026-02-01", "2026-02-28"),
      selected: undefined,
    });

    expect(
      weeks
        .flat()
        .flatMap((cell) => Option.toArray(cell))
        .map((day) => day.day)
    ).toEqual(Array.from({ length: 28 }, (_, index) => index + 1));
  });

  const days = (model: ReturnType<typeof monthCalendarModel>) =>
    new Map(
      model.weeks
        .flat()
        .flatMap((cell) => Option.toArray(cell))
        .map((day) => [day.date, day] as const)
    );

  test("marks today alone, whatever its state", () => {
    const november = days(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-11", "2026-11-30"),
        selected: undefined,
        today: "2026-11-10",
      })
    );

    expect(
      [...november.values()].filter((day) => day.today).map((day) => day.date)
    ).toEqual(["2026-11-10"]);
    expect(november.get("2026-11-10")?.state).toBe("past");
  });

  test("bands an inclusive range from its start to its end", () => {
    const november = days(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-10", "2026-11-30"),
        selected: "2026-11-23",
        range: { start: "2026-11-23", end: "2026-11-25" },
      })
    );
    const part = (date: PragueDate) =>
      Option.getOrUndefined(november.get(date)?.range ?? Option.none());

    expect(
      [
        "2026-11-22",
        "2026-11-23",
        "2026-11-24",
        "2026-11-25",
        "2026-11-26",
      ].map(part)
    ).toEqual([undefined, "start", "middle", "end", undefined]);
  });

  test("draws no band for a range of one day", () => {
    const november = days(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-10", "2026-11-30"),
        selected: "2026-11-23",
        range: { start: "2026-11-23", end: "2026-11-23" },
      })
    );

    expect([...november.values()].some((day) => Option.isSome(day.range))).toBe(
      false
    );
  });

  test("keeps an unavailable day in a range unavailable and out of the band", () => {
    const day = days(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-10", "2026-11-30", ["2026-11-24"]),
        selected: "2026-11-23",
        range: { start: "2026-11-23", end: "2026-11-25" },
      })
    ).get("2026-11-24");

    expect(day?.state).toBe("unavailable");
    expect(day && Option.isNone(day.range)).toBe(true);
  });

  test("focuses only the focused day, leaving its state as it is", () => {
    const november = days(
      monthCalendarModel({
        month: { year: 2026, month: 11 },
        dates: dateChoice("2026-11-10", "2026-11-30", ["2026-11-20"]),
        selected: undefined,
        focused: "2026-11-20",
      })
    );

    expect(
      [...november.values()].filter((day) => day.focused).map((day) => day.date)
    ).toEqual(["2026-11-20"]);
    expect(november.get("2026-11-20")?.state).toBe("unavailable");
  });
});
