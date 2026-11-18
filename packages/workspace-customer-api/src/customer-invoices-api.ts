import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { CustomerAccountLinkRequired } from "./customer-account-api";
import { CustomerPlainDate } from "./customer-booking-selection";
import { CustomerLocale } from "./customer-locale";
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
export class CustomerInvoiceNotFound extends Schema.TaggedError<CustomerInvoiceNotFound>()(
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

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

/**
 * What an invoiced order booked and when, as the invoice froze it. A booking
 * of whole days starts and ends at Prague midnights.
 */
export const CustomerInvoicedReservation = Schema.Struct({
  /**
   * The catalog name of the booked product in the request's locale, as the
   * reservation history names it.
   */
  productName: Schema.NonEmptyString,
  /** The office's seats; absent for a product booked without seats. */
  seats: Schema.optionalKey(Schema.Int),
  startsAt: isoInstant,
  /** Exclusive. */
  endsAt: isoInstant,
}).annotate({ identifier: "CustomerInvoicedReservation" });
export type CustomerInvoicedReservation =
  typeof CustomerInvoicedReservation.Type;

/**
 * One issued invoice. `orderId` names the order it invoices, the ID the
 * reservation history and order status go by, and `reservation` what that
 * order booked and when; an invoice the office issued by hand invoices no
 * order and has neither. `cancellation` is present once the invoice is
 * cancelled; a cancelled invoice is still listed and downloadable.
 */
export const CustomerInvoice = Schema.Struct({
  id: CustomerInvoiceId,
  invoiceNumber: Schema.NonEmptyString,
  /** The Prague calendar date the invoice was issued on. */
  issuedOn: CustomerPlainDate,
  total: CustomerInvoiceTotal,
  orderId: Schema.optionalKey(CustomerReservationOrderId),
  cancellation: Schema.optionalKey(CustomerInvoiceCancellation),
  reservation: Schema.optionalKey(CustomerInvoicedReservation),
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
      /** The language of `productName`; the default locale when absent. */
      query: Schema.Struct({ locale: Schema.optionalKey(CustomerLocale) }),
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
