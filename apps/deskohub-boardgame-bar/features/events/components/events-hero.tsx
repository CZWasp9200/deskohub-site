import { m } from "@/features/i18n";
import { Hero } from "@/shared/components";

export const EventsHero = () => {
  return (
    <Hero tags="Akce" alignment="left">
      <div>
        <h1 className="mb-4 font-bold text-4xl text-green-400 md:text-6xl">
          {m["events.hero.title"]()}
        </h1>
        <p className="max-w-2xl text-gray-200 text-xl">
          {m["events.hero.subtitle"]()}
        </p>
      </div>
    </Hero>
  );
};
