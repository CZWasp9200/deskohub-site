import { ChevronLeft, ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { AccountsUnavailable } from "@/features/account/components/accounts-unavailable";
import { getSessionUser } from "@/features/account/server/session.server";
import { signInHref } from "@/features/account/sign-in-path";
import { listPublishedEvents } from "@/features/events/backend/events.server";
import {
  currentMonth,
  dayOf,
  monthRange,
  parseMonthParam,
} from "@/features/events/calendar-month";
import { EventCard } from "@/features/events/components/event-card";
import { MonthCalendar } from "@/features/events/components/month-calendar";
import { registrationAvailability } from "@/features/events/registration-availability";
import { LocalizedLink, m, setLocale } from "@/features/i18n";
import { PageHeader } from "@/shared/components/page-header";
import { siteConstants } from "@/shared/utils/constants";
import { formatDate } from "@/shared/utils/date-formatting";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: () => m["events.pageTitle"](),
  description: () => m["events.pageDescription"](),
});

type EventsPageProps = RouteProps_locale & {
  searchParams: Promise<{ month?: string }>;
};

export default async function EventsPage({
  params,
  searchParams,
}: EventsPageProps) {
  if (!siteConstants.featureFlags.accounts) notFound();

  const { locale } = await params;
  setLocale(locale);

  const now = new Date();
  const month = parseMonthParam((await searchParams).month, now);
  const { from, to } = monthRange(month);
  const monthLabel = formatDate(from, locale, {
    month: "long",
    year: "numeric",
  });

  const user = await getSessionUser();
  const events = await listPublishedEvents({ from, to, userId: user?.id });

  const monthHref = (target: Temporal.PlainYearMonth) =>
    `/events?month=${target.toString()}`;
  const navButtonClass =
    "inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-700 text-gray-200 hover:bg-gray-800 hover:text-white";

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <PageHeader
        title={m["events.title"]()}
        subtitle={m["events.subtitle"]()}
      />

      {events === undefined ? (
        <AccountsUnavailable />
      ) : (
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <nav
            className="mb-6 flex flex-wrap items-center gap-3"
            aria-label={m["events.title"]()}
          >
            <LocalizedLink
              href={monthHref(month.subtract({ months: 1 }))}
              className={navButtonClass}
              aria-label={m["events.previousMonth"]()}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </LocalizedLink>
            <h2 className="min-w-44 text-center text-2xl font-semibold capitalize">
              {monthLabel}
            </h2>
            <LocalizedLink
              href={monthHref(month.add({ months: 1 }))}
              className={navButtonClass}
              aria-label={m["events.nextMonth"]()}
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </LocalizedLink>
            {!month.equals(currentMonth(now)) && (
              <LocalizedLink
                href="/events"
                className="ml-2 text-sm font-medium text-green-400 underline-offset-4 hover:underline"
              >
                {m["events.currentMonth"]()}
              </LocalizedLink>
            )}
          </nav>

          <MonthCalendar
            month={month}
            monthLabel={monthLabel}
            events={events}
            today={dayOf(now)}
            locale={locale}
          />

          {events.length === 0 ? (
            <section className="py-12 text-center md:py-16">
              <h3 className="text-xl font-semibold">
                {m["events.empty.title"]()}
              </h3>
              <p className="mt-2 text-gray-400">{m["events.empty.hint"]()}</p>
            </section>
          ) : (
            <section className="md:mt-10">
              <h3 className="mb-4 hidden text-lg font-semibold text-gray-200 md:block">
                {m["events.listTitle"]()}
              </h3>
              <ul className="space-y-4">
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    availability={registrationAvailability(event, {
                      signedIn: user !== null,
                      now,
                    })}
                    signInHref={signInHref(monthHref(month))}
                    locale={locale}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
