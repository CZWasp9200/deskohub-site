import { markPrivateResponse } from "./private-response";

/**
 * The `Content-Disposition` of a file download named `filename`. Every
 * character outside ASCII letters, digits, `_`, `.`, and `-` becomes `_`, so
 * the name stays inside its quotes.
 */
export const attachmentContentDisposition = (
  /** An ASCII file name such as `WS-FV-2026-000042.pdf`. */
  filename: string
) => `attachment; filename="${filename.replaceAll(/[^\w.-]/g, "_")}"`;

/** A private file download, named as `attachmentContentDisposition` names it. */
export const createDownloadResponse = ({
  body,
  contentType,
  filename,
}: {
  readonly body: BodyInit;
  readonly contentType: string;
  /** An ASCII file name such as `WS-FV-2026-000042.pdf`. */
  readonly filename: string;
}) =>
  markPrivateResponse(
    new Response(body, {
      headers: {
        "Content-Disposition": attachmentContentDisposition(filename),
        "Content-Type": contentType,
      },
    })
  );
