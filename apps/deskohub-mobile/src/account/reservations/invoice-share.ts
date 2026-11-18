import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import { Atom } from "effect/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import { shareInvoicePdf } from "../invoices/invoice-pdf-share";

/** The name the shared PDF carries; the contract doesn't expose the invoice number. */
export const invoiceFileName = (orderId: CustomerReservationOrderId) =>
  `invoice-${orderId}.pdf`;

const readInvoice = (orderId: CustomerReservationOrderId) =>
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.reservations.getReservationInvoice({ params: { orderId } })
  ).pipe(customerRead({ accountRead: false }));

/**
 * Downloads the order's invoice and hands it to the share sheet
 * (`shareInvoicePdf`).
 */
export const shareInvoice = (orderId: CustomerReservationOrderId) =>
  shareInvoicePdf(invoiceFileName(orderId), readInvoice(orderId));

/** The order's invoice share action and its last outcome. */
export const invoiceShareAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    customerDataRuntime.fn(() => shareInvoice(orderId))
);
