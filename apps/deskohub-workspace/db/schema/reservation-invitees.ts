import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  bytea,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type {
  ReservationInviteeId,
  ReservationInviteeKeyId,
} from "@/features/reservation-invitees/reservation-invitee";
import { instant } from "../instant";
import { sensitiveText } from "../sensitive-text";
import { postgresUuidV7 } from "../uuid-v7";
import { customerAccounts } from "./customer-accounts";
import { workspaceReservations } from "./workspace-reservations";

/**
 * The people a private office booker added by email address, one row each,
 * written with the reservation's hold and fixed once it is paid. The address
 * is stored only encrypted, with a keyed lookup digest that finds an
 * invitee's reservations for a signed-in account with the same verified
 * email. After `retain_until` the retention purge deletes the row, or, when
 * the address belongs to a registered customer, keeps only the link to that
 * customer and clears the address.
 */
export const reservationInvitees = pgTable(
  "reservation_invitees",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<ReservationInviteeId>(),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id, { onDelete: "cascade" }),
    /** The invitee's place in the list as the booker entered it, from 0. */
    position: smallint("position").notNull(),
    keyId: text("key_id").$type<ReservationInviteeKeyId>(),
    encryptedEmail: bytea("encrypted_email"),
    /** HMAC of the normalized address under `key_id`'s lookup key. */
    emailLookupKey: sensitiveText("email_lookup_key"),
    /** The registered account the purge found for the address. */
    customerAccountId: text("customer_account_id")
      .$type<CustomerAccountId>()
      .references(() => customerAccounts.id),
    /** The Dotypos customer the purge found for the address. */
    dotyposCustomerId: text("dotypos_customer_id").$type<DotyposCustomerId>(),
    retainUntil: instant("retain_until").notNull(),
    lastInvitationSentAt: instant("last_invitation_sent_at"),
    /** Invitation emails sent so far; keys each send's idempotency. */
    invitationSendCount: integer("invitation_send_count").notNull().default(0),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("reservation_invitees_reservation_position_idx").on(
      t.workspaceReservationId,
      t.position
    ),
    uniqueIndex("reservation_invitees_reservation_lookup_idx").on(
      t.workspaceReservationId,
      t.emailLookupKey
    ),
    index("reservation_invitees_email_lookup_idx").on(t.emailLookupKey),
    index("reservation_invitees_customer_account_idx").on(t.customerAccountId),
    index("reservation_invitees_dotypos_customer_idx").on(t.dotyposCustomerId),
    index("reservation_invitees_retain_until_idx").on(t.retainUntil),
    check("reservation_invitees_position_check", sql`${t.position} >= 0`),
    check(
      "reservation_invitees_invitation_send_count_check",
      sql`${t.invitationSendCount} >= 0`
    ),
    check(
      "reservation_invitees_key_id_check",
      sql`${t.keyId} ~ '^[A-Za-z0-9_-]{1,32}$'`
    ),
    check(
      "reservation_invitees_address_check",
      sql`(
        ${t.keyId} IS NOT NULL
        AND ${t.encryptedEmail} IS NOT NULL
        AND ${t.emailLookupKey} IS NOT NULL
      ) OR (
        ${t.keyId} IS NULL
        AND ${t.encryptedEmail} IS NULL
        AND ${t.emailLookupKey} IS NULL
        AND (
          ${t.customerAccountId} IS NOT NULL
          OR ${t.dotyposCustomerId} IS NOT NULL
        )
      )`
    ),
  ]
);
