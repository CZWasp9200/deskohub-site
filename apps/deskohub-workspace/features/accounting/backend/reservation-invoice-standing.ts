import { and, eq, exists, isNotNull, or } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabase } from "@/db/database.service";
import {
  invoiceArchives,
  invoiceCancellations,
  invoiceEmailDeliveries,
  invoices,
} from "@/db/schema";
import type { InvoiceNumber } from "@/features/accounting/invoice";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { isChainTail } from "./invoice-reads";

/**
 * The reservation's latest invoice as its cancellation shows it: a live one
 * is cancelled with the reservation and may owe the customer a notice.
 */
export interface ReservationInvoiceStanding {
  readonly id: InvoiceId;
  readonly invoiceNumber: InvoiceNumber;
  readonly state: "live" | "cancelled";
  /** Hidden from the Admin UI, which then shows no link to it. */
  readonly archived: boolean;
  readonly customerNotice: "owed" | "not_owed";
}

/**
 * Reads the reservation's latest invoice without decrypting it; `null`
 * without one. A plain query on the joining client: it runs inside or
 * outside a transaction.
 */
export const readReservationInvoiceStanding = (
  db: WorkspaceDatabase["Service"]["db"],
  reservationId: WorkspaceReservationId
) =>
  db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      cancelled: exists(
        db
          .select({ invoiceId: invoiceCancellations.invoiceId })
          .from(invoiceCancellations)
          .where(eq(invoiceCancellations.invoiceId, invoices.id))
      ),
      archived: exists(
        db
          .select({ invoiceId: invoiceArchives.invoiceId })
          .from(invoiceArchives)
          .where(eq(invoiceArchives.invoiceId, invoices.id))
      ),
      // The SQL twin of `isCustomerCancellationNoticeOwed`: the customer's
      // invoice email was ever accepted, or is being delivered.
      customerNoticeOwed: exists(
        db
          .select({ invoiceId: invoiceEmailDeliveries.invoiceId })
          .from(invoiceEmailDeliveries)
          .where(
            and(
              eq(invoiceEmailDeliveries.invoiceId, invoices.id),
              eq(invoiceEmailDeliveries.audience, "customer"),
              or(
                isNotNull(invoiceEmailDeliveries.acceptedAt),
                eq(invoiceEmailDeliveries.state, "processing")
              )
            )
          )
      ),
    })
    .from(invoices)
    .where(and(eq(invoices.workspaceReservationId, reservationId), isChainTail))
    .limit(1)
    .pipe(
      Effect.map(([row]): ReservationInvoiceStanding | null =>
        row
          ? {
              id: row.id as InvoiceId,
              invoiceNumber: row.invoiceNumber,
              state: row.cancelled ? "cancelled" : "live",
              archived: row.archived,
              customerNotice: row.customerNoticeOwed ? "owed" : "not_owed",
            }
          : null
      )
    );
