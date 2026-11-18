import { sql } from "drizzle-orm";
import { bytea, check, index, pgTable, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AccountingSnapshotKeyId } from "@/features/accounting/accounting-document-snapshot";
import type { InvoicePreviewId } from "@/features/accounting/admin/invoice-preview-id";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import { instant } from "../instant";
import { authUser } from "./auth";

/**
 * Rendered invoice previews an administrator's AI agent asked for, kept
 * encrypted for a short while so the administrator can open them in the
 * Admin UI. A preview is no invoice: nothing here issues, numbers or
 * reserves one, and expired rows are deleted.
 */
export const invoicePreviews = pgTable(
  "invoice_previews",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`)
      .$type<InvoicePreviewId>(),
    /** The UUID the previewed input would create its invoice with. */
    invoiceId: text("invoice_id").notNull().$type<InvoiceId>(),
    administratorAccountId: text("administrator_account_id")
      .notNull()
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "cascade" }),
    keyId: text("key_id").notNull().$type<AccountingSnapshotKeyId>(),
    encryptedDocument: bytea("encrypted_document").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [
    index("invoice_previews_expires_at_idx").on(t.expiresAt),
    check(
      "invoice_previews_expiry_check",
      sql`${t.expiresAt} > ${t.createdAt}`
    ),
    check(
      "invoice_previews_key_id_check",
      sql`${t.keyId} ~ '^[A-Z][A-Z0-9_]{2,31}$'`
    ),
  ]
);
