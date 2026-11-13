import { Award, Trophy } from "lucide-react";
import type { AwardedTrophy } from "@/features/account/backend/trophies.server";
import { type Locale, m } from "@/features/i18n";
import { formatDate } from "@/shared/utils/date-formatting";

/** Gold, silver, and bronze for the podium; green for everything else. */
const placementColor = (placement: number | null): string => {
  if (placement === 1) return "text-amber-300";
  if (placement === 2) return "text-slate-300";
  if (placement === 3) return "text-orange-400";
  return "text-green-400";
};

export function TrophyList({
  trophies,
  locale,
}: {
  readonly trophies: readonly AwardedTrophy[];
  readonly locale: Locale;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {trophies.map((trophy) => {
        const Icon = trophy.placement === null ? Award : Trophy;
        return (
          <li
            key={trophy.id}
            className="flex gap-4 rounded-lg border border-gray-700 bg-gray-900/60 p-4"
          >
            <Icon
              className={`mt-0.5 h-8 w-8 shrink-0 ${placementColor(trophy.placement)}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="font-semibold text-white">{trophy.title}</p>
              {trophy.placement !== null && (
                <p className={`text-sm ${placementColor(trophy.placement)}`}>
                  {m["account.trophies.placement"]({ place: trophy.placement })}
                </p>
              )}
              {trophy.eventTitle && trophy.eventTitle !== trophy.title && (
                <p className="text-sm text-gray-300">{trophy.eventTitle}</p>
              )}
              {trophy.note && (
                <p className="text-sm text-gray-400">{trophy.note}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {m["account.trophies.awardedOn"]({
                  date: formatDate(trophy.awardedAt, locale, {
                    dateStyle: "medium",
                  }),
                })}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
