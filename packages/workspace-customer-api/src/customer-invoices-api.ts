import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { CustomerAccountLinkRequired } from "./customer-account-api";
import { CustomerPlainDate } from "./customer-booking-selection";
import {
  CustomerInvoicePdf,
  CustomerReservationOrderId,
} from "./customer-reservations-api";
import { CustomerServiceUnavailable } from "./customer-session";
import { responseHeaders } from "./openapi-response-headers";

// Errors

/**
 * No invoice with this ID that the signed-in account may see: it doesn't
 * exist, or it belongs to someone else.
 */
export class CustomerInvoiceNotFound extends Schema.TaggedErrorClass<CustomerInvoiceNotFound>()(
  "CustomerInvoiceNotFound",
  {}
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}

// Invoices

/**
 * An issued invoice of the signed-in account's customer. Any other text is
 * accepted and answers as not found, like another customer's invoice.
 */
export const CustomerInvoiceId = Schema.NonEmptyString.pipe(
  Schema.brand("InvoiceId")
).annotate({
  identifier: "CustomerInvoiceId",
  description: "Opaque identifier of an issued invoice.",
});
export type CustomerInvoiceId = typeof CustomerInvoiceId.Type;

/** An invoice's total exactly as issued, never rounded. */
export const CustomerInvoiceTotal = Schema.Struct({
  amount: Schema.String.check(Schema.isPattern(/^-?\d+(?:\.\d+)?$/)).annotate({
    description:
      'Exact decimal amount in currency units, such as "258.80" or "280"; never rounded.',
  }),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
}).annotate({ identifier: "CustomerInvoiceTotal" });
export type CustomerInvoiceTotal = typeof CustomerInvoiceTotal.Type;

/** A cancelled invoice's cancellation: the credit note that negates it. */
export const CustomerInvoiceCancellation = Schema.Struct({
  correctiveDocumentNumber: Schema.NonEmptyString,
}).annotate({ identifier: "CustomerInvoiceCancellation" });
export type CustomerInvoiceCancellation =
  typeof CustomerInvoiceCancellation.Type;

/**
 * One issued invoice. `orderId` names the order it invoices, the ID the
 * reservation history and order status go by; an invoice the office issued
 * by hand invoices no order and has none. `cancellation` is present once the
 * invoice is cancelled; a cancelled invoice is still listed and downloadable.
 */
export const CustomerInvoice = Schema.Struct({
  id: CustomerInvoiceId,
  invoiceNumber: Schema.NonEmptyString,
  /** The Prague calendar date the invoice was issued on. */
  issuedOn: CustomerPlainDate,
  total: CustomerInvoiceTotal,
  orderId: Schema.optionalKey(CustomerReservationOrderId),
  cancellation: Schema.optionalKey(CustomerInvoiceCancellation),
}).annotate({ identifier: "CustomerInvoice" });
export type CustomerInvoice = typeof CustomerInvoice.Type;

/** The account's issued invoices, newest issue first. */
export const CustomerInvoiceList = Schema.Struct({
  invoices: Schema.Array(CustomerInvoice),
}).annotate({ identifier: "CustomerInvoiceList" });
export type CustomerInvoiceList = typeof CustomerInvoiceList.Type;

// Endpoints

/**
 * The signed-in customer's issued invoices, and one of them as a PDF. Only
 * invoices issued to the account's own Dotypos customer are listed or
 * served; any other ID is not found.
 */
export const CustomerInvoicesApi = HttpApiGroup.make("invoices")
  .add(
    HttpApiEndpoint.get("listInvoices", "/", {
      success: CustomerInvoiceList,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getInvoicePdf", "/:invoiceId/pdf", {
      params: { invoiceId: CustomerInvoiceId },
      success: CustomerInvoicePdf,
      error: [
        CustomerInvoiceNotFound.schema,
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    }).annotateMerge(
      responseHeaders(200, {
        "Content-Disposition": {
          description:
            'Serves the PDF as an attachment named by the invoice number, as `attachment; filename="<invoice number>.pdf"`.',
        },
      })
    )
  )
  .prefix("/invoices");
