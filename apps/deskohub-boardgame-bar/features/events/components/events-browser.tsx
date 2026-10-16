"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  Ticket,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import type { BarEventView } from "../event-view";

interface EventsBrowserProps {
  readonly events: readonly BarEventView[];
  readonly locale: Locale;
  /** Today in bar local time, `YYYY-MM-DD`, resolved on the server. */
  readonly today: string;
}

type ViewMode = "calendar" | "list";

export function EventsBrowser({ events, locale, today }: EventsBrowserProps) {
  const [mode, setMode] = useState<ViewMode>("calendar");
  const [visibleMonth, setVisibleMonth] = useState(() =>
    firstMonthWithEvents(events, today)
  );
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  const openEvent = events.find((event) => event.id === openEventId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-5 flex items-center justify-center gap-2">
        <ModeButton
          icon={<CalendarDays aria-hidden="true" className="size-4" />}
          isActive={mode === "calendar"}
          label={m["events.view.calendar"]({}, { locale })}
          onClick={() => setMode("calendar")}
        />
        <ModeButton
          icon={<List aria-hidden="true" className="size-4" />}
          isActive={mode === "list"}
          label={m["events.view.list"]({}, { locale })}
          onClick={() => setMode("list")}
        />
      </div>

      {mode === "calendar" ? (
        <MonthCalendar
          events={events}
          locale={locale}
          month={visibleMonth}
          onMonthChange={setVisibleMonth}
          onSelectEvent={setOpenEventId}
          today={today}
        />
      ) : (
        <EventListing
          events={events}
          locale={locale}
          onSelectEvent={setOpenEventId}
        />
      )}

      <EventDialog
        event={openEvent}
        locale={locale}
        onClose={() => setOpenEventId(null)}
      />
    </div>
  );
}

function ModeButton({
  icon,
  isActive,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={isActive}
      className={`flex items-center gap-2 rounded-full border px-4 py-2 font-semibold text-sm transition ${
        isActive
          ? "border-[#4fbba3] bg-[#4fbba3]/15 text-[#a8f0d9]"
          : "border-[#3c3a36] text-[#b9c2d1] hover:border-[#4fbba3]/60 hover:text-white"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function MonthCalendar({
  events,
  locale,
  month,
  onMonthChange,
  onSelectEvent,
  today,
}: {
  events: readonly BarEventView[];
  locale: Locale;
  month: string;
  onMonthChange: (month: string) => void;
  onSelectEvent: (id: string) => void;
  today: string;
}) {
  const weeks = useMemo(() => getMonthWeeks(month), [month]);
  const weekdayNames = useMemo(() => getWeekdayNames(locale), [locale]);

  return (
    <section
      aria-label={m["events.view.calendar"]({}, { locale })}
      className="rounded-2xl border border-[#3c3a36] bg-[#242422] p-3 sm:p-5"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <button
          aria-label={m["events.calendar.previousMonth"]({}, { locale })}
          className="rounded-full border border-[#3c3a36] p-2 text-[#b9c2d1] transition hover:border-[#4fbba3] hover:text-white"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          type="button"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <h2 className="font-bold text-lg text-white capitalize">
          {formatMonth(month, locale)}
        </h2>
        <button
          aria-label={m["events.calendar.nextMonth"]({}, { locale })}
          className="rounded-full border border-[#3c3a36] p-2 text-[#b9c2d1] transition hover:border-[#4fbba3] hover:text-white"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          type="button"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </header>

      <div className="grid grid-cols-7 gap-1 text-center text-[#8a9099] text-[11px] uppercase tracking-[0.08em]">
        {weekdayNames.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flat().map((date) => {
          const dayEvents = events.filter((event) => coversDate(event, date));
          const isOtherMonth = !date.startsWith(month);

          return (
            <div
              className={`min-h-[74px] rounded-lg border p-1 text-left sm:min-h-[96px] ${
                date === today
                  ? "border-[#4fbba3] bg-[#4fbba3]/10"
                  : "border-transparent bg-white/[0.03]"
              }`}
              key={date}
            >
              <span
                className={`block px-1 text-[12px] ${
                  isOtherMonth ? "text-[#5c6066]" : "text-[#b9c2d1]"
                }`}
              >
                {Number(date.slice(8, 10))}
              </span>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {dayEvents.slice(0, 2).map((event) => (
                  <button
                    className="truncate rounded bg-[#4fbba3]/20 px-1 py-0.5 text-left text-[11px] text-[#d8f5ec] transition hover:bg-[#4fbba3]/35"
                    key={event.id}
                    onClick={() => onSelectEvent(event.id)}
                    title={event.title}
                    type="button"
                  >
                    {event.startTime ? `${event.startTime} ` : ""}
                    {event.title}
                  </button>
                ))}
                {dayEvents.length > 2 && (
                  <button
                    className="rounded px-1 text-left text-[11px] text-[#4fbba3] hover:underline"
                    onClick={() => {
                      const next = dayEvents[2];
                      if (next) onSelectEvent(next.id);
                    }}
                    type="button"
                  >
                    {m["events.calendar.more"](
                      { count: dayEvents.length - 2 },
                      { locale }
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EventListing({
  events,
  locale,
  onSelectEvent,
}: {
  events: readonly BarEventView[];
  locale: Locale;
  onSelectEvent: (id: string) => void;
}) {
  if (events.length === 0) {
    return <EmptyState locale={locale} />;
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {events.map((event) => (
        <li key={event.id}>
          <button
            className="flex h-full w-full flex-col gap-3 rounded-2xl border border-[#3c3a36] bg-[#242422] p-4 text-left transition hover:border-[#4fbba3]"
            onClick={() => onSelectEvent(event.id)}
            type="button"
          >
            {event.imageId && (
              <CloudinaryImage
                alt={event.title}
                className="h-[160px] w-full rounded-[10px] bg-[#141311] object-cover"
                source={event.imageId}
                variant="gallery"
              />
            )}
            <span className="flex items-center gap-2 font-semibold text-[#4fbba3] text-sm">
              <CalendarDays aria-hidden="true" className="size-4" />
              {formatSchedule(event, locale)}
            </span>
            <span className="font-bold text-lg text-white leading-tight">
              {event.title}
            </span>
            {event.price && (
              <span className="flex items-center gap-2 text-[#b9c2d1] text-sm">
                <Ticket aria-hidden="true" className="size-4" />
                {event.price}
              </span>
            )}
            {event.description && (
              <span className="line-clamp-3 text-[#b9c2d1] text-[13px]">
                {event.description}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ locale }: { locale: Locale }) {
  return (
    <div className="rounded-2xl border border-[#3c3a36] border-dashed px-5 py-14 text-center text-[#b9c2d1]">
      <strong className="mb-1.5 block text-[#f7f1e0] text-lg">
        {m["events.empty.title"]({}, { locale })}
      </strong>
      {m["events.empty.hint"]({}, { locale })}
    </div>
  );
}

function EventDialog({
  event,
  locale,
  onClose,
}: {
  event: BarEventView | null;
  locale: Locale;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={event !== null}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(92vw,38rem)] overflow-y-auto rounded-2xl border border-[#3c3a36] bg-[#242422] p-5 text-[#f7f1e0] sm:p-7">
          {event && (
            <>
              <div className="flex items-start justify-between gap-4">
                <Dialog.Title className="font-extrabold text-[22px] text-white leading-tight">
                  {event.title}
                </Dialog.Title>
                <Dialog.Close
                  aria-label={m["events.detail.close"]({}, { locale })}
                  className="shrink-0 rounded-full border border-[#3c3a36] p-1.5 text-[#b9c2d1] transition hover:border-[#4fbba3] hover:text-white"
                >
                  <X aria-hidden="true" className="size-4" />
                </Dialog.Close>
              </div>

              <Dialog.Description className="mt-2 flex items-center gap-2 font-semibold text-[#4fbba3] text-sm">
                <CalendarDays aria-hidden="true" className="size-4" />
                {formatSchedule(event, locale)}
              </Dialog.Description>

              {event.imageId && (
                <CloudinaryImage
                  alt={event.title}
                  className="mt-4 max-h-[320px] w-full rounded-xl bg-[#141311] object-contain"
                  source={event.imageId}
                  variant="full"
                />
              )}

              {event.price && (
                <p className="mt-4 flex items-center gap-2 text-[#b9c2d1] text-sm">
                  <Ticket aria-hidden="true" className="size-4" />
                  {event.price}
                </p>
              )}

              {event.description && (
                <p className="mt-4 whitespace-pre-line text-[14px] text-[#d8dee8] leading-[1.6]">
                  {event.description}
                </p>
              )}

              {event.link && (
                <a
                  className="mt-5 inline-block text-[#4fbba3] text-sm hover:underline"
                  href={event.link}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {m["events.moreInfo"]({}, { locale })}
                </a>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** `YYYY-MM-DD` strings compare chronologically, so plain comparisons work. */
const coversDate = (event: BarEventView, date: string): boolean =>
  event.firstDate <= date && date <= event.lastDate;

const firstMonthWithEvents = (
  events: readonly BarEventView[],
  today: string
): string => {
  const upcoming = events.find((event) => event.lastDate >= today);
  return (upcoming?.firstDate ?? today).slice(0, 7);
};

const shiftMonth = (month: string, offset: number): string => {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1 + offset;
  const shifted = new Date(Date.UTC(year, monthIndex, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
};

/** Weeks starting on Monday, including the days around the month's edges. */
const getMonthWeeks = (month: string): string[][] => {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const mondayOffset = (firstOfMonth.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, monthIndex, 1 - mondayOffset));

  const weeks: string[][] = [];
  const cursor = start;
  for (let week = 0; week < 6; week += 1) {
    const days: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      days.push(toDateString(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(days);
    const reachedNextMonth =
      cursor.getUTCMonth() !== monthIndex || cursor.getUTCFullYear() !== year;
    if (reachedNextMonth && week >= 3) break;
  }
  return weeks;
};

const getWeekdayNames = (locale: Locale): string[] => {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_unused, index) =>
    formatter.format(new Date(Date.UTC(2024, 0, 1 + index)))
  );
};

const formatMonth = (month: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDate(`${month}-01`));

const formatDate = (date: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDate(date));

const formatSchedule = (event: BarEventView, locale: Locale): string => {
  if (event.firstDate !== event.lastDate) {
    return `${formatDate(event.firstDate, locale)} – ${formatDate(event.lastDate, locale)}`;
  }
  const date = formatDate(event.firstDate, locale);
  if (!event.startTime) return date;
  return event.endTime
    ? `${date}, ${event.startTime}–${event.endTime}`
    : `${date}, ${event.startTime}`;
};

const toUtcDate = (date: string): Date =>
  new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10))
    )
  );

const toDateString = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const pad = (value: number): string => String(value).padStart(2, "0");
