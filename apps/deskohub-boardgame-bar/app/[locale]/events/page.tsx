import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { EventsHero, EventsList } from "@/features/events";
import { getUpcomingBarEvents } from "@/features/events/backend/get-upcoming-events";
import { getLocale, m, setLocale } from "@/features/i18n";
import { applyCacheTags, eventsTags } from "@/shared/utils/cache-tags";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["events.pageTitle"](),
  description: m["events.pageDescription"](),
});

export default async function EventsPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);
  await connection();

  const events = await loadEvents();

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <EventsHero />
      <EventsList events={events} locale={getLocale()} />
    </div>
  );
}

async function loadEvents() {
  "use cache";

  cacheLife("minutes");
  applyCacheTags(eventsTags.upcoming());

  return getUpcomingBarEvents();
}
