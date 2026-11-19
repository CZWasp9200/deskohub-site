import "server-only";

import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { getAccountsDatabase } from "@/db/database.server";
import { authUser, membershipPlans, memberships } from "@/db/schema";
import { baseLocale, isLocale } from "@/features/i18n";
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

/** Which email: the column that records it sent and the one that claims it. */
type EmailKind = {
  readonly name: "activation" | "expiry-reminder";
  readonly sent: "activationEmailSentAt" | "expiryReminderSentAt";
  readonly claimed: "activationEmailClaimedAt" | "expiryReminderClaimedAt";
};

const activationEmail: EmailKind = {
  name: "activation",
  sent: "activationEmailSentAt",
  claimed: "activationEmailClaimedAt",
};
const expiryReminderEmail: EmailKind = {
  name: "expiry-reminder",
  sent: "expiryReminderSentAt",
  claimed: "expiryReminderClaimedAt",
};

/** How long a claim stays valid; a run that crashed frees the email after it. */
const CLAIM_LEASE_MINUTES = 15;

type DueMembership = {
  readonly id: number;
  readonly email: string;
  readonly name: string;
  readonly locale: string | null;
  readonly planName: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
};

/**
 * The provider's idempotency key for one email: the same on every run, so a
 * retry after an unclear outcome reaches the provider as the same delivery.
 */
export const membershipEmailKey = (membershipId: number, kind: EmailKind) =>
  `membership-${membershipId}-${kind.name}`;

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
 * Sends the membership emails that are due: a payment confirmation for every
 * membership the operator approved and a reminder for every membership that
 * ends within a week with no period following straight after it.
 *
 * Each email is sent before it is marked sent, so a run that dies halfway
 * leaves it due for the next run. A short claim keeps two overlapping runs
 * from sending the same email at once.
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
    locale: authUser.locale,
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
      // A member whose next period starts by the time this one ends has
      // nothing to be reminded of. A later period after a gap still needs
      // the reminder, so the member knows about the days without membership.
      sql`not exists (
        select 1 from memberships later
        where later.user_id = ${memberships.userId}
          and later.status = 'active'
          and later.id <> ${memberships.id}
          and later.starts_at <= ${memberships.endsAt}
          and later.ends_at > ${memberships.endsAt}
      )`
    )
  );

  async function sendOnce(
    membership: DueMembership,
    kind: EmailKind,
    build: (details: MembershipEmailDetails) => EmailMessage
  ): Promise<"sent" | "failed" | "skipped"> {
    if (!(membership.startsAt && membership.endsAt && database)) {
      return "skipped";
    }

    const claimedColumn = memberships[kind.claimed];
    const [claimed] = await database
      .update(memberships)
      .set({ [kind.claimed]: sql`now()` })
      .where(
        and(
          eq(memberships.id, membership.id),
          isNull(memberships[kind.sent]),
          or(
            isNull(claimedColumn),
            lt(
              claimedColumn,
              sql`now() - make_interval(mins => ${CLAIM_LEASE_MINUTES})`
            )
          )
        )
      )
      .returning({ id: memberships.id });
    if (!claimed) return "skipped";

    const sent = await sendEmail({
      ...build({
        email: membership.email,
        name: membership.name,
        planName: membership.planName,
        startsAt: membership.startsAt,
        endsAt: membership.endsAt,
        // Accounts without a saved language get the bar's own.
        locale: isLocale(membership.locale) ? membership.locale : baseLocale,
      }),
      idempotencyKey: membershipEmailKey(membership.id, kind),
    });

    await database
      .update(memberships)
      .set(
        sent
          ? { [kind.sent]: sql`now()`, [kind.claimed]: null }
          : { [kind.claimed]: null }
      )
      .where(eq(memberships.id, membership.id));
    return sent ? "sent" : "failed";
  }

  const run = { activated: 0, expiring: 0, failed: 0 };
  for (const membership of activated) {
    const result = await sendOnce(
      membership,
      activationEmail,
      buildMembershipActivatedEmail
    );
    if (result === "sent") run.activated += 1;
    if (result === "failed") run.failed += 1;
  }
  for (const membership of expiring) {
    const result = await sendOnce(
      membership,
      expiryReminderEmail,
      buildMembershipExpiringEmail
    );
    if (result === "sent") run.expiring += 1;
    if (result === "failed") run.failed += 1;
  }
  return run;
}
