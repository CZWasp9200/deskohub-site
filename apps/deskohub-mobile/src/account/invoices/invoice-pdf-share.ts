import { Cause, Data, Effect, Option } from "effect";
import { AccountScopedStorage } from "../../customer-api/account-scoped-storage";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import {
  DeviceCapabilityFailed,
  ShareSheet,
} from "../../customer-api/device-capabilities";

// The PDF lives until sharing ends; an account exit meanwhile leaves it to
// this share (see `AccountScopedStorage.temporaryFile`).
const temporaryPdf = (input: {
  readonly name: string;
  readonly bytes: Uint8Array;
}) =>
  Effect.flatMap(Effect.service(AccountScopedStorage), (storage) =>
    storage.temporaryFile(input.name, input.bytes)
  );

// The share sheet can't be called back once open, so an interruption waits
// for it to close rather than removing the file it may still be reading.
const shareFile = (name: string) => (uri: Option.Option<string>) =>
  Option.match(uri, {
    onNone: () => Effect.void,
    onSome: (written) =>
      Effect.flatMap(Effect.service(ShareSheet), (sheet) =>
        sheet.shareFile({ uri: written, name, mimeType: "application/pdf" })
      ).pipe(Effect.uninterruptible),
  });

/**
 * Downloads an invoice PDF with `read` and hands it to the share sheet (a
 * download on the web) as `name`, removing the temporary file once sharing
 * ends, however it ends, even after the account exited meanwhile. Nothing is
 * written when the download fails, and nothing is shared after the session
 * ended (the account's storage then writes no file).
 */
export const shareInvoicePdf = <E, R>(
  name: string,
  read: Effect.Effect<Uint8Array, E, R>
) =>
  Effect.flatMap(read, (bytes) =>
    temporaryPdf({ name, bytes }).pipe(
      Effect.flatMap(shareFile(name)),
      Effect.scoped
    )
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
