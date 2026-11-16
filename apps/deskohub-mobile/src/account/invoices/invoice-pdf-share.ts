import type { Effect } from "effect";
import { shareDownloadedFile } from "../../customer-api/share-downloaded-file";

/**
 * Downloads an invoice PDF with `read` and hands it to the share sheet as
 * `name` (`shareDownloadedFile`).
 */
export const shareInvoicePdf = <E, R>(
  name: string,
  read: Effect.Effect<Uint8Array, E, R>
) => shareDownloadedFile({ name, mimeType: "application/pdf" }, read);
