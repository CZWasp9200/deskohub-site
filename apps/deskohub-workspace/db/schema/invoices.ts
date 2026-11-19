import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bytea,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AccountingSnapshotKeyId } from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceNumber } from "@/features/accounting/invoice";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { accountingDocumentSnapshots } from "./accounting-document-snapshots";
import { invoiceCancellations } from "./invoice-cancellations";
import { workspaceReservations } from "./workspace-reservations";

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    workspaceReservationId: text("workspace_reservation_id")
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id),
    paymentAttemptId: text("payment_attempt_id")
      .$type<PaymentAttemptId>()
      .references(() => accountingDocumentSnapshots.paymentAttemptId),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    invoiceNumber: text("invoice_number").notNull().$type<InvoiceNumber>(),
    numberingYear: integer("numbering_year").notNull(),
    numberingSequence: integer("numbering_sequence").notNull(),
    keyId: text("key_id").notNull().$type<AccountingSnapshotKeyId>(),
    encryptedDocument: bytea("encrypted_document").notNull(),
    issuedAt: instant("issued_at").notNull(),
    /**
     * The cancelled invoice of the same reservation this one replaces. The
     * reservation's invoices form one chain: only its tail can be live.
     */
    replacesInvoiceId: text("replaces_invoice_id")
      .$type<InvoiceId>()
      // Annotated: the cancellation table references this one back.
      .references((): AnyPgColumn => invoiceCancellations.invoiceId),
  },
  (t) => [
    check(
      "invoices_dotypos_customer_id_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check("invoices_numbering_sequence_check", sql`${t.numberingSequence} > 0`),
    check(
      "invoices_source_reference_check",
      sql`(${t.workspaceReservationId} is null) = (${t.paymentAttemptId} is null)`
    ),
    check("invoices_key_id_check", sql`${t.keyId} ~ '^[A-Z][A-Z0-9_]{2,31}$'`),
    check(
      "invoices_issued_at_year_check",
      sql`${t.numberingYear} = extract(year from ${t.issuedAt} at time zone 'Europe/Prague')::integer`
    ),
    check(
      "invoices_replacement_reservation_check",
      sql`${t.replacesInvoiceId} is null or ${t.workspaceReservationId} is not null`
    ),
    // One chain root per reservation and per payment attempt; replacements
    // follow their cancelled predecessor.
    uniqueIndex("invoices_reservation_unique_idx")
      .on(t.workspaceReservationId)
      .where(sql`${t.replacesInvoiceId} is null`),
    uniqueIndex("invoices_payment_attempt_unique_idx")
      .on(t.paymentAttemptId)
      .where(sql`${t.replacesInvoiceId} is null`),
    uniqueIndex("invoices_replaces_unique_idx").on(t.replacesInvoiceId),
    uniqueIndex("invoices_id_reservation_unique_idx").on(
      t.id,
      t.workspaceReservationId
    ),
    // A replacement bills the same reservation as the invoice it replaces.
    foreignKey({
      name: "invoices_replacement_reservation_fkey",
      columns: [t.replacesInvoiceId, t.workspaceReservationId],
      foreignColumns: [t.id, t.workspaceReservationId],
    }),
    uniqueIndex("invoices_number_unique_idx").on(t.invoiceNumber),
    uniqueIndex("invoices_year_sequence_unique_idx").on(
      t.numberingYear,
      t.numberingSequence
    ),
    index("invoices_dotypos_customer_idx").on(t.dotyposCustomerId),
  ]
);
