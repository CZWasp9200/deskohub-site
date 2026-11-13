import "server-only";

import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { getAccountsDatabase } from "@/db/database.server";
import { type EventKind, eventRegistrations, events, games } from "@/db/schema";

export type CalendarEvent = {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly kind: EventKind;
  readonly gameName: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly capacity: number | null;
  readonly entryFee: string | null;
  readonly registrationOpen: boolean;
  readonly registrationCount: number;
  /** Whether the signed-in customer is registered; false when signed out. */
  readonly isRegistered: boolean;
};

export type RegistrationOutcome =
  | "registered"
  | "alreadyRegistered"
  | "full"
  | "closed"
  | "notFound";

/**
 * Published events that start inside `[from, to)`, soonest first, or
 * `undefined` when the accounts database isn't configured.
 */
export async function listPublishedEvents({
  from,
  to,
  userId,
}: {
  readonly from: Date;
  readonly to: Date;
  readonly userId: string | undefined;
}): Promise<CalendarEvent[] | undefined> {
  const database = getAccountsDatabase();
  if (!database) return undefined;

  // The subqueries spell out their own table aliases so their columns can't
  // be mistaken for the outer query's.
  const rows = await database
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      kind: events.kind,
      gameName: games.name,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      capacity: events.capacity,
      entryFee: events.entryFee,
      registrationOpen: events.registrationOpen,
      registrationCount: sql<number>`(
        select count(*)::int from event_registrations r
        where r.event_id = ${events.id}
      )`,
      isRegistered: sql<boolean>`exists (
        select 1 from event_registrations r
        where r.event_id = ${events.id} and r.user_id = ${userId ?? ""}
      )`,
    })
    .from(events)
    .leftJoin(games, eq(games.id, events.gameId))
    .where(
      and(
        eq(events.published, true),
        gte(events.startsAt, from),
        lt(events.startsAt, to)
      )
    )
    .orderBy(asc(events.startsAt), asc(events.id));

  return rows;
}

/**
 * Registers the customer for an event. The event row is locked for the
 * check-and-insert, so two customers can't both take the last free place.
 */
export async function registerForEvent(
  eventId: number,
  userId: string
): Promise<RegistrationOutcome> {
  const database = getAccountsDatabase();
  if (!database) return "notFound";

  return database.transaction(async (tx) => {
    const [event] = await tx
      .select({
        capacity: events.capacity,
        registrationOpen: events.registrationOpen,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
      })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.published, true)))
      .for("update");
    if (!event) return "notFound";

    const [existing] = await tx
      .select({ id: eventRegistrations.id })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.eventId, eventId),
          eq(eventRegistrations.userId, userId)
        )
      );
    if (existing) return "alreadyRegistered";

    const isOver = (event.endsAt ?? event.startsAt).getTime() < Date.now();
    if (!event.registrationOpen || isOver) return "closed";

    if (event.capacity !== null) {
      const [taken] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(eventRegistrations)
        .where(eq(eventRegistrations.eventId, eventId));
      if ((taken?.count ?? 0) >= event.capacity) return "full";
    }

    await tx.insert(eventRegistrations).values({ eventId, userId });
    return "registered";
  });
}

export async function cancelEventRegistration(
  eventId: number,
  userId: string
): Promise<void> {
  const database = getAccountsDatabase();
  if (!database) return;

  await database
    .delete(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.eventId, eventId),
        eq(eventRegistrations.userId, userId)
      )
    );
}

export type UpcomingRegistration = {
  readonly eventId: number;
  readonly title: string;
  readonly startsAt: Date;
};

/** Events the customer is registered for that haven't started yet. */
export async function listUpcomingRegistrations(
  userId: string
): Promise<UpcomingRegistration[]> {
  const database = getAccountsDatabase();
  if (!database) return [];

  return database
    .select({
      eventId: events.id,
      title: events.title,
      startsAt: events.startsAt,
    })
    .from(eventRegistrations)
    .innerJoin(events, eq(events.id, eventRegistrations.eventId))
    .where(
      and(
        eq(eventRegistrations.userId, userId),
        eq(events.published, true),
        gte(events.startsAt, new Date())
      )
    )
    .orderBy(asc(events.startsAt));
}
