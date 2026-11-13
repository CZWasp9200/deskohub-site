import type { CalendarEvent } from "@/features/events/backend/events.server";
import { calendarWeeks, dayOf } from "@/features/events/calendar-month";
import { type Locale, m } from "@/features/i18n";
import { formatDate } from "@/shared/utils/date-formatting";

/** Monday 5 January 2026, the anchor for locale weekday names. */
const A_MONDAY = Date.UTC(2026, 0, 5, 12);

const weekdayNames = (locale: Locale): { short: string; long: string }[] =>
  Array.from({ length: 7 }, (_, index) => {
    const day = new Date(A_MONDAY + index * 86_400_000);
    return {
      short: new Intl.DateTimeFormat(locale, {
        weekday: "short",
        timeZone: "UTC",
      }).format(day),
      long: new Intl.DateTimeFormat(locale, {
        weekday: "long",
        timeZone: "UTC",
      }).format(day),
    };
  });

/**
 * Month grid for wider screens. Each event links to its card in the list
 * below, which carries the details and the registration control.
 */
export function MonthCalendar({
  month,
  monthLabel,
  events,
  today,
  locale,
}: {
  readonly month: Temporal.PlainYearMonth;
  readonly monthLabel: string;
  readonly events: readonly CalendarEvent[];
  readonly today: Temporal.PlainDate;
  readonly locale: Locale;
}) {
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const day = dayOf(event.startsAt).toString();
    eventsByDay.set(day, [...(eventsByDay.get(day) ?? []), event]);
  }

  return (
    <table
      className="hidden w-full table-fixed border-collapse md:table"
      aria-label={m["events.calendarLabel"]({ month: monthLabel })}
    >
      <thead>
        <tr>
          {weekdayNames(locale).map((weekday) => (
            <th
              key={weekday.long}
              scope="col"
              abbr={weekday.long}
              className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400"
            >
              {weekday.short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {calendarWeeks(month).map((week, weekIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Weeks of one month have a fixed order and no identity of their own.
          <tr key={weekIndex}>
            {week.map((day, dayIndex) => {
              if (!day) {
                return (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: Empty cells are positional padding.
                    key={dayIndex}
                    className="border border-gray-800 bg-gray-900/40"
                  />
                );
              }
              const dayEvents = eventsByDay.get(day.toString()) ?? [];
              const isToday = day.equals(today);
              return (
                <td
                  key={day.toString()}
                  className={`h-24 border border-gray-800 p-1.5 align-top ${
                    dayEvents.length > 0 ? "bg-gray-800/70" : "bg-gray-900/40"
                  }`}
                >
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                      isToday ? "bg-green-500 text-gray-900" : "text-gray-400"
                    }`}
                    aria-current={isToday ? "date" : undefined}
                  >
                    {day.day}
                  </span>
                  <ul className="mt-1 space-y-1">
                    {dayEvents.map((event) => (
                      <li key={event.id}>
                        <a
                          href={`#event-${event.id}`}
                          className={`block truncate rounded px-1.5 py-0.5 text-xs font-medium hover:underline ${
                            event.kind === "tournament"
                              ? "bg-amber-400/15 text-amber-200"
                              : "bg-green-400/15 text-green-200"
                          }`}
                        >
                          {formatDate(event.startsAt, locale, {
                            timeStyle: "short",
                          })}{" "}
                          {event.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
