import "server-only";

import { asc, eq } from "drizzle-orm";
import { getAccountsDatabase } from "@/db/database.server";
import {
  authSession,
  authUser,
  eventMedals,
  eventRegistrations,
  events,
  membershipPlans,
  memberships,
  trophies,
} from "@/db/schema";

/**
 * One customer's data, for them to download: the profile, memberships, event
 * registrations, trophies and signed-in devices. Session tokens stay out;
 * they identify live sessions. `null` when accounts are off or the user
 * doesn't exist.
 */
export async function buildAccountDataExport(userId: string) {
  const database = getAccountsDatabase();
  if (!database) return null;

  const [[profile], membershipRows, registrationRows, trophyRows, sessionRows] =
    await Promise.all([
      database
        .select({
          name: authUser.name,
          email: authUser.email,
          emailVerified: authUser.emailVerified,
          image: authUser.image,
          locale: authUser.locale,
          createdAt: authUser.createdAt,
          updatedAt: authUser.updatedAt,
        })
        .from(authUser)
        .where(eq(authUser.id, userId)),
      database
        .select({
          plan: membershipPlans.name,
          status: memberships.status,
          priceCzk: memberships.priceCzk,
          requestedAt: memberships.requestedAt,
          startsAt: memberships.startsAt,
          endsAt: memberships.endsAt,
          note: memberships.note,
          activationEmailSentAt: memberships.activationEmailSentAt,
          expiryReminderSentAt: memberships.expiryReminderSentAt,
        })
        .from(memberships)
        .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(memberships.requestedAt)),
      database
        .select({
          event: events.title,
          startsAt: events.startsAt,
          registeredAt: eventRegistrations.createdAt,
        })
        .from(eventRegistrations)
        .innerJoin(events, eq(events.id, eventRegistrations.eventId))
        .where(eq(eventRegistrations.userId, userId))
        .orderBy(asc(events.startsAt)),
      database
        .select({
          title: trophies.title,
          placement: trophies.placement,
          note: trophies.note,
          awardedAt: trophies.awardedAt,
          event: events.title,
          medal: eventMedals.name,
        })
        .from(trophies)
        .leftJoin(events, eq(events.id, trophies.eventId))
        .leftJoin(eventMedals, eq(eventMedals.id, trophies.medalId))
        .where(eq(trophies.userId, userId))
        .orderBy(asc(trophies.awardedAt)),
      database
        .select({
          signedInAt: authSession.createdAt,
          expiresAt: authSession.expiresAt,
          ipAddress: authSession.ipAddress,
          userAgent: authSession.userAgent,
        })
        .from(authSession)
        .where(eq(authSession.userId, userId))
        .orderBy(asc(authSession.createdAt)),
    ]);
  if (!profile) return null;

  return {
    version: 1,
    exportedAt: new Date(),
    profile,
    memberships: membershipRows,
    eventRegistrations: registrationRows,
    trophies: trophyRows,
    sessions: sessionRows,
  };
}
