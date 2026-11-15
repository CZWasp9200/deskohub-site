import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import {
  type AdministrationSource,
  administrationSources,
} from "@/features/administrators/administration-source";
import { instant } from "../instant";
import { sensitiveText } from "../sensitive-text";
import { authUser } from "./auth";
import { invoiceCancellations } from "./invoice-cancellations";
import { quotedSqlList } from "./sql-list";

/**
 * An administrator hid the cancelled invoice from the administration UI.
 * Only a cancelled invoice can be archived: the key references its
 * cancellation. One archive per invoice, never undone.
 */
export const invoiceArchives = pgTable(
  "invoice_archives",
  {
    invoiceId: text("invoice_id")
      .primaryKey()
      .$type<InvoiceId>()
      .references(() => invoiceCancellations.invoiceId),
    archivedAt: instant("archived_at").notNull(),
    actorAccountId: text("actor_account_id")
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "set null" }),
    /** The account's login email when it archived the invoice. */
    actorAccountEmail: sensitiveText("actor_account_email").notNull(),
    source: text("source").notNull().$type<AdministrationSource>(),
  },
  (t) => [
    check(
      "invoice_archives_email_check",
      sql`btrim(${t.actorAccountEmail}) <> ''`
    ),
    check(
      "invoice_archives_source_check",
      sql`${t.source} in (${quotedSqlList(administrationSources)})`
    ),
  ]
);
