import type {
  GoogleCalendarError,
  GoogleCalendarEvent,
} from "@deskohub/google-calendar";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Context, Data, Effect, Layer, Option } from "effect";
import { BoardgameGoogleCalendarLayer } from "@/shared/backend/config/google-calendar.config";
import { siteConstants } from "@/shared/utils/constants";
import { EventsCalendarConfig } from "./events-calendar.config";

/**
 * Only entries explicitly marked with `[bar:event]` are published. Everything
 * else on the calendar stays private planning information, the same rule the
 * opening-hours calendar follows.
 */
const eventMarker = "[bar:event]";

const imageTagPattern = /\[bar:image:([^\]]+)\]/iu;
const priceTagPattern = /\[bar:price:([^\]]+)\]/iu;
const linkTagPattern = /\[bar:link:([^\]]+)\]/iu;
const allTagsPattern = /\[bar:[^\]]*\]/giu;

const maximumDescriptionLength = 2000;

export type BarEventSchedule = Data.TaggedEnum<{
  /** All-day entries, with an inclusive last day. */
  AllDay: {
    readonly startDate: Temporal.PlainDate;
    readonly endDate: Temporal.PlainDate;
  };
  Timed: {
    readonly start: Temporal.ZonedDateTime;
    readonly end: Temporal.ZonedDateTime;
  };
}>;

export const BarEventSchedule = Data.taggedEnum<BarEventSchedule>();

export interface BarEvent {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  /** Cloudinary public id of the poster, e.g. `events/turnaj-carcassonne`. */
  readonly imageId: string | null;
  readonly price: string | null;
  readonly link: string | null;
  readonly schedule: BarEventSchedule;
}

export interface BarEventQuery {
  readonly from: Temporal.PlainDate;
  readonly to: Temporal.PlainDate;
}

export interface IEventsCalendarService {
  readonly listEvents: (
    query: BarEventQuery
  ) => Effect.Effect<readonly BarEvent[], GoogleCalendarError>;
}

export class EventsCalendarService extends Context.Service<
  EventsCalendarService,
  IEventsCalendarService
>()("@deskohub-boardgame-bar/events/EventsCalendarService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const calendar = yield* GoogleCalendarService;
      const { calendarId } = yield* EventsCalendarConfig;

      const listEvents = Effect.fn("EventsCalendarService.listEvents")(
        function* (query: BarEventQuery) {
          yield* Effect.logInfo("Google Calendar bar events load started");

          const calendarEvents = yield* calendar.listEvents({
            calendarId,
            from: query.from.toString(),
            to: query.to.toString(),
          });
          const events = sortByStart(
            calendarEvents.flatMap((event) => toBarEvents(event, query))
          );

          yield* Effect.logInfo("Google Calendar bar events load completed", {
            eventCount: events.length,
          });

          return events;
        },
        (effect, query) =>
          effect.pipe(
            Effect.annotateLogs({
              calendarId,
              from: query.from.toString(),
              to: query.to.toString(),
            }),
            Effect.tapError((cause) =>
              Effect.logError("Google Calendar bar events load failed", {
                cause,
              })
            )
          )
      );

      return { listEvents };
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(BoardgameGoogleCalendarLayer),
    Layer.provide(EventsCalendarConfig.Default)
  );
}

export const getBarEventStart = (event: BarEvent): Temporal.ZonedDateTime =>
  event.schedule._tag === "Timed"
    ? event.schedule.start
    : event.schedule.startDate.toZonedDateTime({
        timeZone: siteConstants.workingHours.timezone,
      });

const sortByStart = (events: readonly BarEvent[]): readonly BarEvent[] =>
  [...events].sort((left, right) =>
    Temporal.ZonedDateTime.compare(
      getBarEventStart(left),
      getBarEventStart(right)
    )
  );

const toBarEvents = (
  event: GoogleCalendarEvent,
  query: BarEventQuery
): readonly BarEvent[] => {
  if (event.status === "cancelled") {
    return [];
  }

  const rawDescription = event.description ?? "";
  const isPublished = rawDescription
    .toLocaleLowerCase("en-US")
    .includes(eventMarker);
  const id = event.id ?? event.iCalUID;
  const title = event.summary?.trim();

  if (!isPublished || !id || !title) {
    return [];
  }

  return Option.match(getSchedule(event), {
    onNone: () => [],
    onSome: (schedule) =>
      isScheduleInRange(schedule, query)
        ? [
            {
              id,
              title,
              description: getDescription(rawDescription),
              imageId: getImageId(rawDescription),
              price: getTagValue(rawDescription, priceTagPattern),
              link: getHttpsTagValue(rawDescription, linkTagPattern),
              schedule,
            },
          ]
        : [],
  });
};

const getSchedule = (
  event: GoogleCalendarEvent
): Option.Option<BarEventSchedule> => {
  const startDate = event.start?.date;
  const endDate = event.end?.date;

  if (startDate && endDate && !event.start?.dateTime && !event.end?.dateTime) {
    return toAllDaySchedule(startDate, endDate);
  }

  const startDateTime = event.start?.dateTime;
  const endDateTime = event.end?.dateTime;

  if (!startDateTime || !endDateTime || event.start?.date || event.end?.date) {
    return Option.none();
  }

  return Option.all({
    start: toBarZonedDateTime(startDateTime, event.start?.timeZone),
    end: toBarZonedDateTime(endDateTime, event.end?.timeZone),
  }).pipe(
    Option.filter(
      ({ end, start }) => Temporal.ZonedDateTime.compare(end, start) > 0
    ),
    Option.map(({ end, start }) => BarEventSchedule.Timed({ start, end }))
  );
};

/** Google reports an exclusive end date for all-day entries. */
const toAllDaySchedule = Option.liftThrowable(
  (start: string, exclusiveEnd: string) => {
    const startDate = Temporal.PlainDate.from(start);
    const endDate = Temporal.PlainDate.from(exclusiveEnd).subtract({ days: 1 });

    if (Temporal.PlainDate.compare(endDate, startDate) < 0) {
      throw new Error("All-day event ends before it starts");
    }

    return BarEventSchedule.AllDay({ startDate, endDate });
  }
);

const toBarZonedDateTime = Option.liftThrowable(
  (dateTime: string, timeZone: string | undefined) =>
    hasExplicitOffset(dateTime)
      ? Temporal.Instant.from(dateTime).toZonedDateTimeISO(
          siteConstants.workingHours.timezone
        )
      : Temporal.PlainDateTime.from(dateTime)
          .toZonedDateTime(timeZone ?? siteConstants.workingHours.timezone)
          .withTimeZone(siteConstants.workingHours.timezone)
);

const hasExplicitOffset = (dateTime: string) =>
  /(?:Z|[+-]\d{2}:\d{2})$/u.test(dateTime);

/**
 * An event stays listed until its last day is over, so a multi-day or evening
 * event does not disappear from the page while it is still running.
 */
const isScheduleInRange = (
  schedule: BarEventSchedule,
  query: BarEventQuery
): boolean => {
  const { firstDate, lastDate } =
    schedule._tag === "AllDay"
      ? { firstDate: schedule.startDate, lastDate: schedule.endDate }
      : {
          firstDate: schedule.start.toPlainDate(),
          lastDate: schedule.end.toPlainDate(),
        };

  return (
    Temporal.PlainDate.compare(lastDate, query.from) >= 0 &&
    Temporal.PlainDate.compare(firstDate, query.to) <= 0
  );
};

const getDescription = (rawDescription: string): string | null => {
  const text = stripHtml(rawDescription)
    .replace(allTagsPattern, " ")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/[^\S\n]*\n[^\S\n]*/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return text ? text.slice(0, maximumDescriptionLength) : null;
};

/** Google Calendar descriptions may contain basic HTML from the web editor. */
const stripHtml = (value: string): string =>
  value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/li>/giu, "\n")
    .replace(/<\/(?:p|div)>/giu, "\n\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");

const getTagValue = (
  rawDescription: string,
  pattern: RegExp
): string | null => {
  const value = rawDescription.match(pattern)?.[1]?.trim();
  return value ? value : null;
};

/**
 * Images are served through Cloudinary, which is the only remote image host
 * the app allows, so the tag carries a public id rather than a URL.
 */
const getImageId = (rawDescription: string): string | null => {
  const value = getTagValue(rawDescription, imageTagPattern);
  return value && /^[\w./-]+$/u.test(value) ? value : null;
};

/**
 * A link tag ends up in `href`, so only absolute https values are published.
 * Anything else (`javascript:`, relative paths) is dropped.
 */
const getHttpsTagValue = (
  rawDescription: string,
  pattern: RegExp
): string | null => {
  const value = getTagValue(rawDescription, pattern);
  return value?.startsWith("https://") ? value : null;
};
