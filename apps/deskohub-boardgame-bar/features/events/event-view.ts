import { Match } from "effect";
import type { BarEvent } from "./backend/events-calendar.service";

/**
 * Serializable shape of an event for the browser. Server components cannot
 * hand `Temporal` values to a client component, so dates travel as plain
 * `YYYY-MM-DD` strings and times as `HH:MM`, both already in bar local time.
 */
export interface BarEventView {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly imageId: string | null;
  readonly price: string | null;
  readonly link: string | null;
  /** First day the event occupies, `YYYY-MM-DD`. */
  readonly firstDate: string;
  /** Last day the event occupies, inclusive, `YYYY-MM-DD`. */
  readonly lastDate: string;
  /** `HH:MM` for timed events, `null` for all-day ones. */
  readonly startTime: string | null;
  readonly endTime: string | null;
}

export const toBarEventView = (event: BarEvent): BarEventView => {
  const { firstDate, lastDate, startTime, endTime } = Match.value(
    event.schedule
  ).pipe(
    Match.tagsExhaustive({
      AllDay: ({ endDate, startDate }) => ({
        firstDate: startDate.toString(),
        lastDate: endDate.toString(),
        startTime: null,
        endTime: null,
      }),
      Timed: ({ end, start }) => ({
        firstDate: start.toPlainDate().toString(),
        lastDate: end.toPlainDate().toString(),
        startTime: toHourMinute(start),
        endTime: toHourMinute(end),
      }),
    })
  );

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    imageId: event.imageId,
    price: event.price,
    link: event.link,
    firstDate,
    lastDate,
    startTime,
    endTime,
  };
};

const toHourMinute = (dateTime: Temporal.ZonedDateTime): string =>
  `${String(dateTime.hour).padStart(2, "0")}:${String(dateTime.minute).padStart(2, "0")}`;
