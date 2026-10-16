import { describe, expect, mock, test } from "bun:test";
import {
  type GoogleCalendarEvent,
  GoogleCalendarEventIdSchema,
  GoogleCalendarIdSchema,
  type GoogleCalendarListEventsInput,
} from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { Effect, Layer, Schema } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

setBoardgameTestEnv();

type BarEventQuery = {
  readonly from: Temporal.PlainDate;
  readonly to: Temporal.PlainDate;
};

const defaultQuery = {
  from: Temporal.PlainDate.from("2026-08-02"),
  to: Temporal.PlainDate.from("2026-09-02"),
} satisfies BarEventQuery;

const eventId = Schema.decodeSync(GoogleCalendarEventIdSchema);
const eventsCalendarId = Schema.decodeSync(GoogleCalendarIdSchema)(
  "events-calendar"
);

const runWithEvents = async (
  events: readonly GoogleCalendarEvent[],
  query = defaultQuery,
  onListEvents?: (input: GoogleCalendarListEventsInput) => void
) => {
  const [{ EventsCalendarConfig }, { EventsCalendarService }] =
    await Promise.all([
      import("./events-calendar.config"),
      import("./events-calendar.service"),
    ]);

  return Effect.gen(function* () {
    const service = yield* EventsCalendarService;
    return yield* service.listEvents(query);
  }).pipe(
    Effect.provide(
      EventsCalendarService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            GoogleCalendarServiceMock({
              listEvents: mock((input) => {
                onListEvents?.(input);
                return Effect.succeed([...events]);
              }),
            }),
            Layer.succeed(EventsCalendarConfig, {
              calendarId: eventsCalendarId,
            })
          )
        )
      )
    ),
    Effect.runPromise
  );
};

describe("EventsCalendarService", () => {
  test("loads the configured calendar and publishes marked events", async () => {
    const inputs: GoogleCalendarListEventsInput[] = [];
    const events = await runWithEvents(
      [
        {
          id: eventId("tournament"),
          summary: "Turnaj v Carcassonne",
          description: "Přijďte si zahrát. [bar:event] [bar:price:150 Kč]",
          start: { dateTime: "2026-08-14T18:00:00", timeZone: "Europe/Prague" },
          end: { dateTime: "2026-08-14T22:00:00", timeZone: "Europe/Prague" },
        },
      ],
      defaultQuery,
      (input) => inputs.push(input)
    );

    expect(inputs).toEqual([
      {
        calendarId: eventsCalendarId,
        from: "2026-08-02",
        to: "2026-09-02",
      },
    ]);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.title).toBe("Turnaj v Carcassonne");
    expect(event?.description).toBe("Přijďte si zahrát.");
    expect(event?.price).toBe("150 Kč");
    expect(event?.schedule._tag).toBe("Timed");
  });

  test("ignores unmarked and cancelled entries", async () => {
    const events = await runWithEvents([
      {
        id: eventId("private-planning"),
        summary: "Porada",
        description: "Interní schůzka bez značky",
        start: { dateTime: "2026-08-05T10:00:00", timeZone: "Europe/Prague" },
        end: { dateTime: "2026-08-05T11:00:00", timeZone: "Europe/Prague" },
      },
      {
        id: eventId("cancelled-event"),
        status: "cancelled",
        summary: "Zrušený turnaj",
        description: "[bar:event]",
        start: { dateTime: "2026-08-06T18:00:00", timeZone: "Europe/Prague" },
        end: { dateTime: "2026-08-06T20:00:00", timeZone: "Europe/Prague" },
      },
    ]);

    expect(events).toEqual([]);
  });

  test("keeps all-day entries until their last day and sorts by start", async () => {
    const events = await runWithEvents([
      {
        id: eventId("later"),
        summary: "Herní večer",
        description: "[bar:event]",
        start: { dateTime: "2026-08-20T18:00:00", timeZone: "Europe/Prague" },
        end: { dateTime: "2026-08-20T23:00:00", timeZone: "Europe/Prague" },
      },
      {
        id: eventId("festival"),
        summary: "Festival",
        description: "[bar:event]",
        start: { date: "2026-08-01" },
        end: { date: "2026-08-04" },
      },
    ]);

    expect(events.map((event) => event.title)).toEqual([
      "Festival",
      "Herní večer",
    ]);
    const [festival] = events;
    expect(festival?.schedule).toMatchObject({
      _tag: "AllDay",
      startDate: Temporal.PlainDate.from("2026-08-01"),
      endDate: Temporal.PlainDate.from("2026-08-03"),
    });
  });

  test("drops entries that ended before the queried range", async () => {
    const events = await runWithEvents([
      {
        id: eventId("past"),
        summary: "Minulá akce",
        description: "[bar:event]",
        start: { date: "2026-07-20" },
        end: { date: "2026-07-22" },
      },
    ]);

    expect(events).toEqual([]);
  });

  test("publishes only safe image and link tags", async () => {
    const events = await runWithEvents([
      {
        id: eventId("tagged"),
        summary: "Akce s plakátem",
        description:
          "[bar:event] [bar:image:events/turnaj] [bar:link:https://deskohub.cz/akce]",
        start: { date: "2026-08-10" },
        end: { date: "2026-08-11" },
      },
      {
        id: eventId("unsafe"),
        summary: "Akce s nebezpečným odkazem",
        description:
          "[bar:event] [bar:image:javascript:alert(1)] [bar:link:javascript:alert(1)]",
        start: { date: "2026-08-11" },
        end: { date: "2026-08-12" },
      },
    ]);

    expect(events[0]).toMatchObject({
      imageId: "events/turnaj",
      link: "https://deskohub.cz/akce",
    });
    expect(events[1]).toMatchObject({ imageId: null, link: null });
  });

  test("turns calendar HTML descriptions into plain text", async () => {
    const events = await runWithEvents([
      {
        id: eventId("html"),
        summary: "Akce",
        description:
          "<p>První odstavec.</p><p>Druhý &amp; poslední.<br>Nový řádek.</p>[bar:event]",
        start: { date: "2026-08-12" },
        end: { date: "2026-08-13" },
      },
    ]);

    expect(events[0]?.description).toBe(
      "První odstavec.\n\nDruhý & poslední.\nNový řádek."
    );
  });
});
