import "server-only";

import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { getAccountsDatabase } from "@/db/database.server";
import { authUser, membershipPlans, memberships } from "@/db/schema";
import { baseLocale } from "@/features/i18n";
import { BoardgameEmailLayer } from "@/shared/backend/config/email.config";
import {
  buildMembershipActivatedEmail,
  buildMembershipExpiringEmail,
  type MembershipEmailDetails,
} from "./membership-email";

/** How long before the end of a membership the member is reminded. */
const EXPIRY_REMINDER_DAYS = 7;

export type MembershipEmailRun = {
  readonly activated: number;
  readonly expiring: number;
  readonly failed: number;
};

type SentColumn = "activationEmailSentAt" | "expiryReminderSentAt";

type DueMembership = {
  readonly id: number;
  readonly email: string;
  readonly name: string;
  readonly planName: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
};

const sendEmail = (message: EmailMessage): Promise<boolean> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const emailService = yield* EmailServiceTag;
      yield* emailService.send(message);
      return true;
    }).pipe(
      Effect.tapError((error) =>
        Effect.logError("Failed to send a membership email", { error })
      ),
      Effect.orElseSucceed(() => false),
      Effect.provide(BoardgameEmailLayer)
    )
  );

/**
 * Sends the membership emails that are due: a confirmation for every
 * membership that became active and a reminder for every membership that
 * ends within a week and has no follow-up period. Each email goes out once;
 * one that fails to send is retried on the next run.
 */
export async function sendDueMembershipEmails(): Promise<
  MembershipEmailRun | undefined
> {
  const database = getAccountsDatabase();
  if (!database) return undefined;

  const dueColumns = {
    id: memberships.id,
    email: authUser.email,
    name: authUser.name,
    planName: membershipPlans.name,
    startsAt: memberships.startsAt,
    endsAt: memberships.endsAt,
  };
  const dueMemberships = () =>
    database
      .select(dueColumns)
      .from(memberships)
      .innerJoin(authUser, eq(authUser.id, memberships.userId))
      .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId));

  const stillRunning = sql`${memberships.endsAt} > now()`;
  const activated = await dueMemberships().where(
    and(
      eq(memberships.status, "active"),
      isNull(memberships.activationEmailSentAt),
      stillRunning
    )
  );
  const expiring = await dueMemberships().where(
    and(
      eq(memberships.status, "active"),
      isNull(memberships.expiryReminderSentAt),
      stillRunning,
      sql`${memberships.endsAt} <= now() + make_interval(days => ${EXPIRY_REMINDER_DAYS})`,
      // A member who already renewed has nothing to be reminded of.
      sql`not exists (
        select 1 from memberships later
        where later.user_id = ${memberships.userId}
          and later.status = 'active'
          and later.ends_at > ${memberships.endsAt}
      )`
    )
  );

  /**
   * Marks the email as sent before sending it, so two overlapping runs can't
   * both send it, and clears the mark again when the send fails.
   */
  async function sendOnce(
    membership: DueMembership,
    column: SentColumn,
    build: (details: MembershipEmailDetails) => EmailMessage
  ): Promise<"sent" | "failed" | "skipped"> {
    if (!(membership.startsAt && membership.endsAt && database)) {
      return "skipped";
    }

    const unsent = and(
      eq(memberships.id, membership.id),
      isNull(memberships[column])
    );
    const [claimed] = await database
      .update(memberships)
      .set({ [column]: new Date() })
      .where(unsent)
      .returning({ id: memberships.id });
    if (!claimed) return "skipped";

    const sent = await sendEmail(
      build({
        email: membership.email,
        name: membership.name,
        planName: membership.planName,
        startsAt: membership.startsAt,
        endsAt: membership.endsAt,
        // The member's language isn't stored; the bar's own language it is.
        locale: baseLocale,
      })
    );
    if (sent) return "sent";

    await database
      .update(memberships)
      .set({ [column]: null })
      .where(eq(memberships.id, membership.id));
    return "failed";
  }

  const run = { activated: 0, expiring: 0, failed: 0 };
  for (const membership of activated) {
    const result = await sendOnce(
      membership,
      "activationEmailSentAt",
      buildMembershipActivatedEmail
    );
    if (result === "sent") run.activated += 1;
    if (result === "failed") run.failed += 1;
  }
  for (const membership of expiring) {
    const result = await sendOnce(
      membership,
      "expiryReminderSentAt",
      buildMembershipExpiringEmail
    );
    if (result === "sent") run.expiring += 1;
    if (result === "failed") run.failed += 1;
  }
  return run;
}
