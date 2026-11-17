import { Cause, Data, Effect, Option } from "effect";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "./customer-view-error";
import { DeviceCapabilityFailed } from "./device-capabilities";
import { shareTemporaryFile } from "./share-temporary-file";

/**
 * Downloads a file with `read` and hands it to the share sheet (a download on
 * the web) as `name` (`shareTemporaryFile`). Nothing is written when the
 * download fails.
 */
export const shareDownloadedFile = <E, R>(
  file: { readonly name: string; readonly mimeType: string },
  read: Effect.Effect<Uint8Array, E, R>
) =>
  Effect.flatMap(read, (bytes) =>
    shareTemporaryFile({ name: file.name, mimeType: file.mimeType, bytes })
  );

/** Why sharing a downloaded file failed, as the screens explain it. */
export type DownloadShareFailure = Data.TaggedEnum<{
  /** The file couldn't be downloaded. */
  Download: { readonly error: CustomerViewError };
  /** The device couldn't store or share the file. */
  Share: Record<never, never>;
}>;
export const DownloadShareFailure = Data.taggedEnum<DownloadShareFailure>();

export const downloadShareFailureOf = (
  cause: Cause.Cause<CustomerRequestFailure | DeviceCapabilityFailed>
): DownloadShareFailure =>
  Option.match(Cause.findErrorOption(cause), {
    // A defect or interruption is unexpected, as `viewErrorOf` treats it.
    onNone: () =>
      DownloadShareFailure.Download({ error: CustomerViewError.Unexpected() }),
    onSome: (error) =>
      error instanceof DeviceCapabilityFailed
        ? DownloadShareFailure.Share()
        : DownloadShareFailure.Download({ error: toCustomerViewError(error) }),
  });
