import type { EmailDeliveryId } from "@deskohub/email";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bytea,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AccountingSnapshotKeyId } from "@/features/accounting/accounting-document-snapshot";
import type { CorrectiveDocumentNumber } from "@/features/accounting/corrective-document";
import {
  type InvoiceCancellationCause,
  invoiceCancellationCauses,
} from "@/features/accounting/invoice-cancellation";
import type {
  InvoiceEmailDeliveryAudience,
  InvoiceEmailDeliveryFailureCode,
  InvoiceEmailDeliveryState,
} from "@/features/accounting/invoice-email-delivery";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import {
  type AdministrationSource,
  administrationSources,
} from "@/features/administrators/administration-source";
import { instant } from "../instant";
import { sensitiveText } from "../sensitive-text";
import { postgresUuidV7 } from "../uuid-v7";
import { authUser } from "./auth";
import {
  invoiceEmailDeliveryAudiences,
  invoiceEmailDeliveryStates,
} from "./invoice-email-deliveries";
import { invoices } from "./invoices";
import { quotedSqlList } from "./sql-list";

/**
 * An administrator cancelled the invoice. Issued invoices are immutable, so
 * the cancellation lives beside the invoice: one per invoice, never undone.
 * It has no immutability trigger, so the actor's account can be detached when
 * it is deleted.
 */
export const invoiceCancellations = pgTable(
  "invoice_cancellations",
  {
    invoiceId: text("invoice_id")
      .primaryKey()
      .$type<InvoiceId>()
      // Annotated: `invoices.replaces_invoice_id` references this table back.
      .references((): AnyPgColumn => invoices.id),
    cancelledAt: instant("cancelled_at").notNull(),
    cause: text("cause").notNull().$type<InvoiceCancellationCause>(),
    actorAccountId: text("actor_account_id")
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "set null" }),
    /** The account's login email when it cancelled the invoice. */
    actorAccountEmail: sensitiveText("actor_account_email").notNull(),
    source: text("source").notNull().$type<AdministrationSource>(),
  },
  (t) => [
    check(
      "invoice_cancellations_cause_check",
      sql`${t.cause} in (${quotedSqlList(invoiceCancellationCauses)})`
    ),
    check(
      "invoice_cancellations_email_check",
      sql`btrim(${t.actorAccountEmail}) <> ''`
    ),
    check(
      "invoice_cancellations_source_check",
      sql`${t.source} in (${quotedSqlList(administrationSources)})`
    ),
  ]
);

/**
 * The corrective document a cancellation issues, numbered in its own annual
 * series and encrypted like the invoice document. A trigger rejects every
 * update and delete.
 */
export const correctiveDocuments = pgTable(
  "corrective_documents",
  {
    cancelledInvoiceId: text("cancelled_invoice_id")
      .primaryKey()
      .$type<InvoiceId>()
      .references(() => invoiceCancellations.invoiceId),
    documentNumber: text("document_number")
      .notNull()
      .$type<CorrectiveDocumentNumber>(),
    numberingYear: integer("numbering_year").notNull(),
    numberingSequence: integer("numbering_sequence").notNull(),
    keyId: text("key_id").notNull().$type<AccountingSnapshotKeyId>(),
    encryptedDocument: bytea("encrypted_document").notNull(),
    issuedAt: instant("issued_at").notNull(),
  },
  (t) => [
    check(
      "corrective_documents_numbering_sequence_check",
      sql`${t.numberingSequence} > 0`
    ),
    check(
      "corrective_documents_key_id_check",
      sql`${t.keyId} ~ '^[A-Z][A-Z0-9_]{2,31}$'`
    ),
    check(
      "corrective_documents_issued_at_year_check",
      sql`${t.numberingYear} = extract(year from ${t.issuedAt} at time zone 'Europe/Prague')::integer`
    ),
    uniqueIndex("corrective_documents_number_unique_idx").on(t.documentNumber),
    uniqueIndex("corrective_documents_year_sequence_unique_idx").on(
      t.numberingYear,
      t.numberingSequence
    ),
  ]
);

/**
 * The cancellation notice owed to each audience, tracked like
 * `invoice_email_deliveries`: the customer's when the invoice was sent to
 * them, the internal accounting copy always.
 */
export const invoiceCancellationNoticeDeliveries = pgTable(
  "invoice_cancellation_notice_deliveries",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    invoiceId: text("invoice_id")
      .notNull()
      .$type<InvoiceId>()
      .references(() => invoiceCancellations.invoiceId),
    audience: text("audience").notNull().$type<InvoiceEmailDeliveryAudience>(),
    state: text("state").notNull().$type<InvoiceEmailDeliveryState>(),
    attemptCount: integer("attempt_count").notNull(),
    providerDeliveryId: text("provider_delivery_id").$type<EmailDeliveryId>(),
    failureCode: text("failure_code").$type<InvoiceEmailDeliveryFailureCode>(),
    acceptedAt: instant("accepted_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "invoice_cancellation_notice_deliveries_audience_check",
      sql`${t.audience} in (${quotedSqlList(invoiceEmailDeliveryAudiences)})`
    ),
    check(
      "invoice_cancellation_notice_deliveries_state_check",
      sql`${t.state} in (${quotedSqlList(invoiceEmailDeliveryStates)})`
    ),
    check(
      "invoice_cancellation_notice_deliveries_attempt_count_check",
      sql`${t.attemptCount} > 0`
    ),
    check(
      "invoice_cancellation_notice_deliveries_accepted_check",
      sql`${t.state} <> 'accepted' or (${t.providerDeliveryId} is not null and ${t.acceptedAt} is not null and ${t.failureCode} is null)`
    ),
    check(
      "invoice_cancellation_notice_deliveries_failed_check",
      sql`${t.state} <> 'failed' or ${t.failureCode} is not null`
    ),
    uniqueIndex(
      "invoice_cancellation_notice_deliveries_invoice_audience_unique_idx"
    ).on(t.invoiceId, t.audience),
    index("invoice_cancellation_notice_deliveries_state_updated_idx").on(
      t.state,
      t.updatedAt
    ),
  ]
);
