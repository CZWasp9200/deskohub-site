import { HttpServerResponse } from "effect/http";
import { attachmentContentDisposition } from "@/shared/utils/download-response";

/** A file an endpoint serves as a download. */
export type CustomerFileDownload = {
  readonly bytes: Uint8Array;
  readonly fileName: string;
};

/**
 * The file as a download of `contentType` named by its file name. The
 * contract declares the bytes; the name travels in `Content-Disposition`,
 * which the contract's success can't carry and the endpoint's OpenAPI
 * annotation describes. The router marks the response private and uncached.
 */
export const answerFileDownload =
  (contentType: string) =>
  ({ bytes, fileName }: CustomerFileDownload) =>
    HttpServerResponse.uint8Array(bytes, {
      contentType,
      headers: {
        "content-disposition": attachmentContentDisposition(fileName),
      },
    });
