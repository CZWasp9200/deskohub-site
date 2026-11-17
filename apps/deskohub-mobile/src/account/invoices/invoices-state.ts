import type {
  CustomerInvoiceId,
  CustomerLocale,
} from "@deskohub/workspace-customer-api";
import { Effect, Match } from "effect";
import { type AsyncResult, Atom } from "effect/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import type { CustomerRequestFailure } from "../../customer-api/customer-view-error";
import type { DeviceCapabilityFailed } from "../../customer-api/device-capabilities";
import {
  type DownloadShareFailure,
  downloadShareFailureOf,
} from "../../customer-api/share-downloaded-file";
import { invoiceListOf, invoicePdfName } from "./invoice-list-model";
import { shareInvoicePdf } from "./invoice-pdf-share";

/**
 * The account's issued invoices (GET /invoices) as the list shows them,
 * each product named in `locale`, read each time the screen opens.
 */
export const invoiceListAtom = Atom.family((locale: CustomerLocale) =>
  customerDataRuntime.atom(
    Effect.flatMap(Effect.service(CustomerApi), (api) =>
      api.invoices.listInvoices({ query: { locale } })
    ).pipe(
      customerRead({ accountRead: false }),
      Effect.map(({ invoices }) => invoiceListOf(invoices))
    )
  )
);

/** The invoice a download fetches; its number names the file. */
export interface InvoiceDownload {
  readonly id: CustomerInvoiceId;
  readonly invoiceNumber: string;
}

/**
 * Downloads one invoice's PDF (GET /invoices/:id/pdf) and hands it to the
 * share sheet, a download on the web (`shareInvoicePdf`).
 */
const downloadInvoice = ({ id, invoiceNumber }: InvoiceDownload) =>
  shareInvoicePdf(
    invoicePdfName(invoiceNumber),
    Effect.flatMap(Effect.service(CustomerApi), (api) =>
      api.invoices.getInvoicePdf({ params: { invoiceId: id } })
    ).pipe(customerRead({ accountRead: false }))
  );

/**
 * The invoice list's download and the outcome of the last one. One at a
 * time: the list holds every row while one downloads, so a failure always
 * belongs to the download the screen reports.
 */
export const invoiceDownloadAtom = customerDataRuntime.fn(downloadInvoice);

/** Where an invoice's download stands, as its row shows it. */
export type InvoiceDownloadState =
  | { readonly kind: "idle" }
  | { readonly kind: "downloading" }
  | { readonly kind: "failed"; readonly failure: DownloadShareFailure };

export const invoiceDownloadState = (
  result: AsyncResult.AsyncResult<
    void,
    CustomerRequestFailure | DeviceCapabilityFailed
  >
): InvoiceDownloadState =>
  result.waiting
    ? { kind: "downloading" }
    : Match.value(result).pipe(
        Match.tagsExhaustive({
          Initial: () => ({ kind: "idle" }) as const,
          // The share sheet took the file; nothing more to show.
          Success: () => ({ kind: "idle" }) as const,
          Failure: ({ cause }) =>
            ({
              kind: "failed",
              failure: downloadShareFailureOf(cause),
            }) as const,
        })
      );
