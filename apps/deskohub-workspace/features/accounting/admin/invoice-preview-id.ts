import { Schema } from "effect";

/** Names one kept invoice preview in its Admin UI download path. */
export const invoicePreviewIdSchema = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("InvoicePreviewId"))
  .annotate({ identifier: "InvoicePreviewId" });
export type InvoicePreviewId = typeof invoicePreviewIdSchema.Type;
