import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import type { ReservationInviteeId } from "@/features/reservation-invitees/reservation-invitee";
import { instant } from "../instant";
import { sensitiveText } from "../sensitive-text";
import { postgresUuidV7 } from "../uuid-v7";
import { reservationInvitees } from "./reservation-invitees";

export type InviteeNoticeUncertainty =
  | "request-changed"
  | "replay-expired"
  | "not-replayable"
  | "superseded";

export type RestoredInviteeAccess = "past" | "link" | "issued";

export type ReservationInviteeNoticeKind =
  | "invitation"
  | "cancellation"
  | "restoration";

/** Delivery work contains references and timing only. The worker opens the address when sending. */
export const reservationInviteeNotices = pgTable(
  "reservation_invitee_notices",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    inviteeId: text("invitee_id")
      .notNull()
      .$type<ReservationInviteeId>()
      .references(() => reservationInvitees.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<ReservationInviteeNoticeKind>(),
    occurredAt: instant("occurred_at").notNull(),
    /** Set when a booker requests this invitation, even if confirmation created it. */
    explicitResend: boolean("explicit_resend").notNull().default(false),
    nextAttemptAt: instant("next_attempt_at").notNull().default(sql`now()`),
    attemptCount: integer("attempt_count").notNull().default(0),
    /** Freezes the restoration copy before its first provider attempt. */
    restoredAccess: text("restored_access").$type<RestoredInviteeAccess>(),
    /** First time the current provider request could have reached the provider. */
    requestStartedAt: instant("request_started_at"),
    requestFingerprint: sensitiveText("request_fingerprint"),
    uncertainty: text("uncertainty").$type<InviteeNoticeUncertainty>(),
    settledAt: instant("settled_at"),
  },
  (t) => [
    unique("reservation_invitee_notices_event_unique").on(
      t.inviteeId,
      t.kind,
      t.occurredAt
    ),
    index("reservation_invitee_notices_due_idx")
      .on(t.nextAttemptAt, t.id)
      .where(sql`${t.settledAt} is null`),
    check(
      "reservation_invitee_notices_explicit_resend_check",
      sql`not ${t.explicitResend} or ${t.kind} = 'invitation'`
    ),
    check(
      "reservation_invitee_notices_access_check",
      sql`${t.restoredAccess} is null or (
      ${t.kind} = 'restoration' and ${t.restoredAccess} in ('past', 'link', 'issued')
    )`
    ),
    check(
      "reservation_invitee_notices_attempt_check",
      sql`(${t.requestStartedAt} is null) = (${t.requestFingerprint} is null)
        and (${t.uncertainty} is null or (
          ${t.settledAt} is not null and ${t.requestStartedAt} is not null
          and ${t.uncertainty} in ('request-changed', 'replay-expired', 'not-replayable', 'superseded')
        ))`
    ),
    check(
      "reservation_invitee_notices_kind_check",
      sql`${t.kind} in ('invitation', 'cancellation', 'restoration')`
    ),
  ]
);
