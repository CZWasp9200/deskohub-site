import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { Match } from "effect";
import { CalendarDays, Ticket } from "lucide-react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import type {
  BarEvent,
  BarEventSchedule,
} from "../backend/events-calendar.service";

interface EventsListProps {
  readonly events: readonly BarEvent[];
  readonly locale: Locale;
}

export function EventsList({ events, locale }: EventsListProps) {
  if (events.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <strong className="mb-1.5 block text-[#f7f1e0] text-lg">
          {m["events.empty.title"]({}, { locale })}
        </strong>
        <p className="text-[#b9c2d1]">
          {m["events.empty.hint"]({}, { locale })}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {events.map((event) => (
          <li
            className="flex flex-col gap-3 rounded-2xl border border-[#3c3a36] bg-[#242422] p-4"
            key={event.id}
          >
            {event.imageId && (
              <CloudinaryImage
                alt={event.title}
                className="h-[180px] w-full rounded-[10px] bg-[#141311] object-cover"
                source={event.imageId}
                variant="gallery"
              />
            )}
            <div className="flex items-center gap-2 text-[#4fbba3] text-sm">
              <CalendarDays aria-hidden="true" className="size-4" />
              <span className="font-semibold">
                {formatSchedule(event.schedule, locale)}
              </span>
            </div>
            <h2 className="font-bold text-lg text-white leading-tight">
              {event.title}
            </h2>
            {event.price && (
              <p className="flex items-center gap-2 text-[#b9c2d1] text-sm">
                <Ticket aria-hidden="true" className="size-4" />
                {event.price}
              </p>
            )}
            {event.description && (
              <p className="whitespace-pre-line text-[#b9c2d1] text-[13px] leading-normal">
                {event.description}
              </p>
            )}
            {event.link && (
              <a
                className="text-[#4fbba3] text-sm hover:underline"
                href={event.link}
                rel="noopener noreferrer"
                target="_blank"
              >
                {m["events.moreInfo"]({}, { locale })}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const formatSchedule = (schedule: BarEventSchedule, locale: Locale): string =>
  Match.value(schedule).pipe(
    Match.tagsExhaustive({
      AllDay: ({ endDate, startDate }) =>
        Temporal.PlainDate.compare(startDate, endDate) === 0
          ? formatDate(startDate, locale)
          : `${formatDate(startDate, locale)} – ${formatDate(endDate, locale)}`,
      Timed: ({ end, start }) => {
        const date = formatDate(start.toPlainDate(), locale);
        const startTime = formatTime(start, locale);
        const endsSameDay =
          Temporal.PlainDate.compare(start.toPlainDate(), end.toPlainDate()) ===
          0;

        return endsSameDay
          ? `${date}, ${startTime}–${formatTime(end, locale)}`
          : `${date}, ${startTime}`;
      },
    })
  );

const formatDate = (date: Temporal.PlainDate, locale: Locale): string =>
  date.toLocaleString(locale, {
    day: "numeric",
    month: "long",
    weekday: "short",
    year: "numeric",
  });

const formatTime = (dateTime: Temporal.ZonedDateTime, locale: Locale): string =>
  dateTime.toPlainTime().toLocaleString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
