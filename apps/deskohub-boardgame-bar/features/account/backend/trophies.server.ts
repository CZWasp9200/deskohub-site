import "server-only";

import { desc, eq } from "drizzle-orm";
import { getAccountsDatabase } from "@/db/database.server";
import { eventMedals, events, trophies } from "@/db/schema";

export type AwardedTrophy = {
  readonly id: number;
  readonly title: string;
  /** 1 for the winner, 2 for second place…; `null` for an unranked trophy. */
  readonly placement: number | null;
  readonly note: string | null;
  readonly awardedAt: Date;
  readonly eventTitle: string | null;
  /** The themed medal awarded with the trophy, if the operator chose one. */
  readonly medal: { readonly id: number; readonly name: string } | null;
};

/** The customer's trophies, newest first. */
export async function listTrophies(userId: string): Promise<AwardedTrophy[]> {
  const database = getAccountsDatabase();
  if (!database) return [];

  const rows = await database
    .select({
      id: trophies.id,
      title: trophies.title,
      placement: trophies.placement,
      note: trophies.note,
      awardedAt: trophies.awardedAt,
      eventTitle: events.title,
      medalId: eventMedals.id,
      medalName: eventMedals.name,
    })
    .from(trophies)
    .leftJoin(events, eq(events.id, trophies.eventId))
    .leftJoin(eventMedals, eq(eventMedals.id, trophies.medalId))
    .where(eq(trophies.userId, userId))
    .orderBy(desc(trophies.awardedAt), desc(trophies.id));

  return rows.map(({ medalId, medalName, ...trophy }) => ({
    ...trophy,
    medal:
      medalId !== null && medalName !== null
        ? { id: medalId, name: medalName }
        : null,
  }));
}
