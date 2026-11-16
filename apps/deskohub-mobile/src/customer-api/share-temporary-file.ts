import { Effect, Option } from "effect";
import { AccountScopedStorage } from "./account-scoped-storage";
import { ShareSheet } from "./device-capabilities";

/**
 * Writes `bytes` to an account's temporary file and hands it to the share
 * sheet (a download on the web), removing the file once sharing ends,
 * however it ends, even after the account exited meanwhile. Nothing is
 * shared after the session ended: the account's storage then writes no file.
 */
export const shareTemporaryFile = (file: {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}) =>
  Effect.flatMap(Effect.service(AccountScopedStorage), (storage) =>
    storage.temporaryFile(file.name, file.bytes)
  ).pipe(
    // The share sheet can't be called back once open, so an interruption
    // waits for it to close rather than removing the file it may still be
    // reading.
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (uri) =>
          Effect.flatMap(Effect.service(ShareSheet), (sheet) =>
            sheet.shareFile({ uri, name: file.name, mimeType: file.mimeType })
          ).pipe(Effect.uninterruptible),
      })
    ),
    Effect.scoped
  );
