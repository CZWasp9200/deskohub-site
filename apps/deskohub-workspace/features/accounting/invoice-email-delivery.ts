export type InvoiceEmailDeliveryAudience = "customer" | "internal";

export type InvoiceEmailDeliveryState = "processing" | "accepted" | "failed";

export type InvoiceEmailDeliveryFailureCode =
  | "email_send_failed"
  | "pdf_render_failed";
