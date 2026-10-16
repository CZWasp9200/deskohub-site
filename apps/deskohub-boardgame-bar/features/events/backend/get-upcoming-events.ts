import "server-only";

import { Effect } from "effect";
import { siteConstants } from "@/shared/utils/constants";
import {
  type BarEvent,
  EventsCalendarService,
} from "./events-calendar.service";

const upcomingWindowDays = 365;
const maximumDisplayedEvents = 24;

/**
 * Upcoming published events, oldest first. An unconfigured or unreachable
 * calendar yields an empty list instead of failing the page.
 */
export async function getUpcomingBarEvents(): Promise<readonly BarEvent[]> {
  const today = Temporal.Now.instant()
    .toZonedDateTimeISO(siteConstants.workingHours.timezone)
    .toPlainDate();
  const query = {
    from: today,
    to: today.add({ days: upcomingWindowDays }),
  };

  const loadEvents = Effect.gen(function* () {
    const eventsCalendar = yield* EventsCalendarService;
    return yield* eventsCalendar.listEvents(query);
  }).pipe(
    Effect.provide(EventsCalendarService.Live),
    Effect.map((events) => events.slice(0, maximumDisplayedEvents)),
    Effect.tapError((cause) =>
      Effect.logError("Bar events are unavailable", { cause })
    ),
    Effect.orElseSucceed(() => [] as readonly BarEvent[])
  );

  return Effect.runPromise(loadEvents);
}
