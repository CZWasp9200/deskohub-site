import "server-only";

import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getAccountsDatabase } from "@/db/database.server";
import { membershipPlans, memberships } from "@/db/schema";

export type MembershipPlan = {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly priceCzk: number;
  readonly durationDays: number;
  readonly benefits: readonly string[];
};

export type MembershipState = {
  /** The membership that is valid right now, if any. */
  readonly current: {
    readonly planName: string;
    readonly endsAt: Date;
  } | null;
  /** A request that waits for payment, if any. */
  readonly pendingRequest: {
    readonly planId: number;
    readonly planName: string;
    readonly priceCzk: number;
    readonly requestedAt: Date;
  } | null;
};

export type MembershipRequestOutcome =
  | "requested"
  | "alreadyRequested"
  | "planUnavailable";

/** Plans offered right now, or `undefined` without an accounts database. */
export async function listOfferedPlans(): Promise<
  MembershipPlan[] | undefined
> {
  const database = getAccountsDatabase();
  if (!database) return undefined;

  return database
    .select({
      id: membershipPlans.id,
      name: membershipPlans.name,
      description: membershipPlans.description,
      priceCzk: membershipPlans.priceCzk,
      durationDays: membershipPlans.durationDays,
      benefits: membershipPlans.benefits,
    })
    .from(membershipPlans)
    .where(eq(membershipPlans.active, true))
    .orderBy(asc(membershipPlans.sortOrder), asc(membershipPlans.id));
}

export async function getMembershipState(
  userId: string
): Promise<MembershipState> {
  const database = getAccountsDatabase();
  if (!database) return { current: null, pendingRequest: null };

  const [[current], [pendingRequest]] = await Promise.all([
    database
      .select({ planName: membershipPlans.name, endsAt: memberships.endsAt })
      .from(memberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          gt(memberships.endsAt, new Date())
        )
      )
      // A renewal starts when the running membership ends, so the latest
      // end date is the day the customer stops being a member.
      .orderBy(desc(memberships.endsAt))
      .limit(1),
    database
      .select({
        planId: memberships.planId,
        planName: membershipPlans.name,
        priceCzk: memberships.priceCzk,
        requestedAt: memberships.requestedAt,
      })
      .from(memberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
      .where(
        and(eq(memberships.userId, userId), eq(memberships.status, "requested"))
      )
      .limit(1),
  ]);

  return {
    current: current?.endsAt
      ? { planName: current.planName, endsAt: current.endsAt }
      : null,
    pendingRequest: pendingRequest ?? null,
  };
}

/**
 * Records that the customer wants a plan. Nothing is charged: the request
 * waits until the operator confirms the payment in the admin app.
 */
export async function requestMembership(
  userId: string,
  planId: number
): Promise<MembershipRequestOutcome> {
  const database = getAccountsDatabase();
  if (!database) return "planUnavailable";

  const [plan] = await database
    .select({ priceCzk: membershipPlans.priceCzk })
    .from(membershipPlans)
    .where(
      and(eq(membershipPlans.id, planId), eq(membershipPlans.active, true))
    );
  if (!plan) return "planUnavailable";

  // A partial unique index allows one waiting request per customer, so a
  // double click or a second tab ends up as a no-op instead of a duplicate.
  const inserted = await database
    .insert(memberships)
    .values({ userId, planId, status: "requested", priceCzk: plan.priceCzk })
    .onConflictDoNothing()
    .returning({ id: memberships.id });

  return inserted.length > 0 ? "requested" : "alreadyRequested";
}

export async function cancelMembershipRequest(userId: string): Promise<void> {
  const database = getAccountsDatabase();
  if (!database) return;

  await database
    .update(memberships)
    .set({ status: "cancelled" })
    .where(
      and(eq(memberships.userId, userId), eq(memberships.status, "requested"))
    );
}
