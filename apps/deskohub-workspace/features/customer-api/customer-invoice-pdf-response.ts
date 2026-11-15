import { HttpServerResponse } from "effect/unstable/http";
import type { InvoicePdfFile } from "@/features/accounting/backend/invoice-pdf";

/**
 * An invoice as a download named by its number. The contract declares the
 * bytes; the file name travels in `Content-Disposition`, which the
 * contract's success can't carry and its OpenAPI annotation describes.
 */
export const answerInvoicePdf = ({ bytes, fileName }: InvoicePdfFile) =>
  HttpServerResponse.uint8Array(bytes, {
    contentType: "application/pdf",
    headers: { "content-disposition": `attachment; filename="${fileName}"` },
  });
