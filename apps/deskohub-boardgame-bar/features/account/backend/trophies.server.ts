import "server-only";

import { desc, eq } from "drizzle-orm";
import { getAccountsDatabase } from "@/db/database.server";
import { events, trophies } from "@/db/schema";

export type AwardedTrophy = {
  readonly id: number;
  readonly title: string;
  /** 1 for the winner, 2 for second place…; `null` for an unranked trophy. */
  readonly placement: number | null;
  readonly note: string | null;
  readonly awardedAt: Date;
  readonly eventTitle: string | null;
};

/** The customer's trophies, newest first. */
export async function listTrophies(userId: string): Promise<AwardedTrophy[]> {
  const database = getAccountsDatabase();
  if (!database) return [];

  return database
    .select({
      id: trophies.id,
      title: trophies.title,
      placement: trophies.placement,
      note: trophies.note,
      awardedAt: trophies.awardedAt,
      eventTitle: events.title,
    })
    .from(trophies)
    .leftJoin(events, eq(events.id, trophies.eventId))
    .where(eq(trophies.userId, userId))
    .orderBy(desc(trophies.awardedAt), desc(trophies.id));
}
