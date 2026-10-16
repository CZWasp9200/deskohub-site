import type { GoogleCalendarId } from "@deskohub/google-calendar";
import { Context, Data, Effect, Layer } from "effect";
import { env } from "@/env";

export interface IEventsCalendarConfig {
  readonly calendarId: GoogleCalendarId;
}

/**
 * The events calendar is optional: a deployment without
 * `GOOGLE_CALENDAR_EVENTS_ID` keeps the rest of the site working and simply
 * publishes no events.
 */
export class EventsCalendarNotConfiguredError extends Data.TaggedError(
  "EventsCalendarNotConfiguredError"
)<{
  readonly message: string;
}> {}

export class EventsCalendarConfig extends Context.Service<
  EventsCalendarConfig,
  IEventsCalendarConfig
>()("@deskohub-boardgame-bar/events/EventsCalendarConfig") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const calendarId = env.GOOGLE_CALENDAR_EVENTS_ID;

      if (!calendarId) {
        return yield* Effect.fail(
          new EventsCalendarNotConfiguredError({
            message: "GOOGLE_CALENDAR_EVENTS_ID is not set",
          })
        );
      }

      return { calendarId };
    })
  );
}
