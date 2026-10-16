import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type {
  BarEvent,
  BarEventSchedule,
} from "./backend/events-calendar.service";
import { toBarEventView } from "./event-view";

// Built as plain values so the test never loads the calendar service, which
// reads the app environment at import time.
const timed = (start: string, end: string): BarEventSchedule => ({
  _tag: "Timed",
  start: Temporal.ZonedDateTime.from(start),
  end: Temporal.ZonedDateTime.from(end),
});

const allDay = (startDate: string, endDate: string): BarEventSchedule => ({
  _tag: "AllDay",
  startDate: Temporal.PlainDate.from(startDate),
  endDate: Temporal.PlainDate.from(endDate),
});

const baseEvent = {
  id: "event-id",
  title: "Turnaj",
  description: "Popis",
  imageId: null,
  price: null,
  link: null,
} satisfies Omit<BarEvent, "schedule">;

describe("toBarEventView", () => {
  test("sends a timed event as local dates and times, not Temporal values", () => {
    const view = toBarEventView({
      ...baseEvent,
      schedule: timed(
        "2026-08-14T18:00:00+02:00[Europe/Prague]",
        "2026-08-14T22:30:00+02:00[Europe/Prague]"
      ),
    });

    expect(view).toMatchObject({
      firstDate: "2026-08-14",
      lastDate: "2026-08-14",
      startTime: "18:00",
      endTime: "22:30",
    });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  test("keeps an all-day event's inclusive last day and reports no times", () => {
    const view = toBarEventView({
      ...baseEvent,
      schedule: allDay("2026-11-07", "2026-11-09"),
    });

    expect(view).toMatchObject({
      firstDate: "2026-11-07",
      lastDate: "2026-11-09",
      startTime: null,
      endTime: null,
    });
  });

  test("reports the last day of an event that runs past midnight", () => {
    const view = toBarEventView({
      ...baseEvent,
      schedule: timed(
        "2026-08-14T20:00:00+02:00[Europe/Prague]",
        "2026-08-15T02:00:00+02:00[Europe/Prague]"
      ),
    });

    expect(view).toMatchObject({
      firstDate: "2026-08-14",
      lastDate: "2026-08-15",
      startTime: "20:00",
      endTime: "02:00",
    });
  });
});
