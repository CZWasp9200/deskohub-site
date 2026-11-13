import { CalendarDays, Dices, Ticket, Users } from "lucide-react";
import type { CalendarEvent } from "@/features/events/backend/events.server";
import {
  type RegistrationAvailability,
  RegistrationControl,
} from "@/features/events/components/registration-control";
import { type Locale, m } from "@/features/i18n";
import { formatDate } from "@/shared/utils/date-formatting";

function formatEventTime(event: CalendarEvent, locale: Locale): string {
  const start = formatDate(event.startsAt, locale, {
    dateStyle: "full",
    timeStyle: "short",
  });
  if (!event.endsAt) return start;

  const sameDay =
    formatDate(event.startsAt, "en-CA", { dateStyle: "short" }) ===
    formatDate(event.endsAt, "en-CA", { dateStyle: "short" });
  const end = formatDate(
    event.endsAt,
    locale,
    sameDay ? { timeStyle: "short" } : { dateStyle: "full", timeStyle: "short" }
  );
  return `${start} – ${end}`;
}

export function EventCard({
  event,
  availability,
  signInHref,
  locale,
}: {
  readonly event: CalendarEvent;
  readonly availability: RegistrationAvailability;
  readonly signInHref: string;
  readonly locale: Locale;
}) {
  const isTournament = event.kind === "tournament";
  const detailClass = "flex items-center gap-2 text-sm text-gray-300";
  const iconClass = "h-4 w-4 shrink-0 text-gray-500";

  return (
    <li
      id={`event-${event.id}`}
      className="scroll-mt-[calc(var(--header-height)+1rem)] rounded-lg border border-gray-700 bg-gray-800/60 p-5 target:border-green-500"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-72">
          <p
            className={`mb-1 text-xs font-semibold uppercase tracking-wide ${
              isTournament ? "text-amber-300" : "text-green-400"
            }`}
          >
            {isTournament
              ? m["events.kind.tournament"]()
              : m["events.kind.event"]()}
          </p>
          <h3 className="text-xl font-semibold text-white">{event.title}</h3>

          <ul className="mt-3 space-y-1.5">
            <li className={detailClass}>
              <CalendarDays className={iconClass} aria-hidden />
              <time dateTime={event.startsAt.toISOString()}>
                {formatEventTime(event, locale)}
              </time>
            </li>
            {event.gameName && (
              <li className={detailClass}>
                <Dices className={iconClass} aria-hidden />
                {m["events.game"]({ game: event.gameName })}
              </li>
            )}
            {event.entryFee && (
              <li className={detailClass}>
                <Ticket className={iconClass} aria-hidden />
                {m["events.entryFee"]({ fee: event.entryFee })}
              </li>
            )}
            <li className={detailClass}>
              <Users className={iconClass} aria-hidden />
              {event.capacity === null
                ? m["events.registered"]({ count: event.registrationCount })
                : m["events.registeredOfCapacity"]({
                    count: event.registrationCount,
                    capacity: event.capacity,
                  })}
            </li>
          </ul>

          {event.description && (
            <p className="mt-4 max-w-2xl whitespace-pre-line text-gray-300">
              {event.description}
            </p>
          )}
        </div>

        <RegistrationControl
          eventId={event.id}
          availability={availability}
          signInHref={signInHref}
        />
      </div>
    </li>
  );
}
