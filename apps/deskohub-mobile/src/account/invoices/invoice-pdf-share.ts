import { Cause, Data, Effect, Option } from "effect";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import { DeviceCapabilityFailed } from "../../customer-api/device-capabilities";
import { shareTemporaryFile } from "../../customer-api/share-temporary-file";

/**
 * Downloads an invoice PDF with `read` and hands it to the share sheet as
 * `name` (`shareTemporaryFile`). Nothing is written when the download fails.
 */
export const shareInvoicePdf = <E, R>(
  name: string,
  read: Effect.Effect<Uint8Array, E, R>
) =>
  Effect.flatMap(read, (bytes) =>
    shareTemporaryFile({ name, mimeType: "application/pdf", bytes })
  );

/** Why sharing an invoice failed, as the screens explain it. */
export type InvoiceShareFailure = Data.TaggedEnum<{
  /** The invoice couldn't be downloaded. */
  Download: { readonly error: CustomerViewError };
  /** The device couldn't store or share the file. */
  Share: Record<never, never>;
}>;
export const InvoiceShareFailure = Data.taggedEnum<InvoiceShareFailure>();

export const invoiceShareFailureOf = (
  cause: Cause.Cause<CustomerRequestFailure | DeviceCapabilityFailed>
): InvoiceShareFailure =>
  Option.match(Cause.findErrorOption(cause), {
    // A defect or interruption is unexpected, as `viewErrorOf` treats it.
    onNone: () =>
      InvoiceShareFailure.Download({ error: CustomerViewError.Unexpected() }),
    onSome: (error) =>
      error instanceof DeviceCapabilityFailed
        ? InvoiceShareFailure.Share()
        : InvoiceShareFailure.Download({ error: toCustomerViewError(error) }),
  });
