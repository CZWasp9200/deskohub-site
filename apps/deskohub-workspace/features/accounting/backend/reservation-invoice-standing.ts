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
import type { InvoiceCancellationCause } from "@/features/accounting/invoice-cancellation";
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
  /** Why a cancelled invoice was cancelled; `null` for a live one. */
  readonly cancellationCause: InvoiceCancellationCause | null;
  /** Hidden from the Admin UI, which then shows no link to it. */
  readonly archived: boolean;
  readonly customerNotice: "owed" | "not_owed";
}

const getCancellationCause = (row: {
  readonly cancelled: unknown;
  readonly cancelledWithReservation: unknown;
}): InvoiceCancellationCause | null => {
  if (row.cancelled !== true) return null;
  return row.cancelledWithReservation === true
    ? "reservation_cancellation"
    : "invoice_cancellation";
};

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
      cancelledWithReservation: exists(
        db
          .select({ invoiceId: invoiceCancellations.invoiceId })
          .from(invoiceCancellations)
          .where(
            and(
              eq(invoiceCancellations.invoiceId, invoices.id),
              eq(invoiceCancellations.cause, "reservation_cancellation")
            )
          )
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
              state: row.cancelled === true ? "cancelled" : "live",
              cancellationCause: getCancellationCause(row),
              archived: row.archived === true,
              customerNotice:
                row.customerNoticeOwed === true ? "owed" : "not_owed",
            }
          : null
      )
    );

/**
 * Whether restoring the reservation issues a replacement for its latest
 * invoice: the invoice was cancelled with the reservation. A credit note is
 * never undone, so the restored reservation gets a new invoice instead; one
 * an administrator cancelled on its own stays without a replacement.
 */
export const isInvoiceReplacedOnRestoration = (
  standing: ReservationInvoiceStanding | null
) => standing?.cancellationCause === "reservation_cancellation";
