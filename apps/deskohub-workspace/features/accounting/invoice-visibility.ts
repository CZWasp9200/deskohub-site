import type { InvoiceCancellationFact } from "@/features/accounting/invoice-cancellation";

/** What decides where an issued invoice shows. */
export interface InvoiceStanding {
  readonly cancellation: InvoiceCancellationFact | null;
  readonly archivedAt: Temporal.Instant | null;
}

export type InvoiceVisibility = "listed" | "listed_cancelled" | "hidden";

/**
 * Where the administration UI shows an invoice: a cancelled one stays listed
 * and marked, an archived one is hidden from the list and every UI route.
 * The Admin API, dhw and agent tools read every invoice.
 */
export const adminUiInvoiceVisibility = (
  standing: InvoiceStanding
): InvoiceVisibility => {
  if (standing.archivedAt !== null) return "hidden";
  return standing.cancellation === null ? "listed" : "listed_cancelled";
};

/**
 * Where the customer's account shows an invoice. Archiving declutters the
 * administration UI only: the customer keeps every issued invoice, and a
 * cancelled or archived one is listed and marked cancelled. Its SQL twin is
 * `isVisibleToCustomer`.
 */
export const customerInvoiceVisibility = (
  standing: InvoiceStanding
): Exclude<InvoiceVisibility, "hidden"> =>
  standing.cancellation === null ? "listed" : "listed_cancelled";
