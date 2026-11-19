import type {
  InvoiceAdministrationListEntry,
  InvoiceAdministrationUnreadableListItem,
} from "./invoice-administration.service";

/** Whether the list row is an invoice whose document could not be read. */
export const isUnreadableInvoiceListEntry = (
  entry: InvoiceAdministrationListEntry
): entry is InvoiceAdministrationUnreadableListItem =>
  "documentUnavailable" in entry;
