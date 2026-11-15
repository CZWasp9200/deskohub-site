export type InvoiceEmailDeliveryAudience = "customer" | "internal";

export type InvoiceEmailDeliveryState = "processing" | "accepted" | "failed";

/** An audience's delivery state, or `missing` before its first claim. */
export type InvoiceDeliveryStatus = "missing" | InvoiceEmailDeliveryState;

export type InvoiceEmailDeliveryFailureCode =
  | "email_send_failed"
  | "pdf_render_failed";

/** The invoice email ledger of one invoice, per audience. */
export interface InvoiceDeliverySummary
  extends Readonly<
    Record<InvoiceEmailDeliveryAudience, InvoiceDeliveryStatus>
  > {
  /** An audience is missing or failed, or its delivery outlived its lease. */
  readonly needsAttention: boolean;
  /**
   * The audiences whose invoice email the provider ever accepted. A later
   * resend or retry that is processing or failed keeps the audience: the
   * acceptance stays recorded.
   */
  readonly sentTo: readonly InvoiceEmailDeliveryAudience[];
}

/** Whether the invoice email was ever accepted for the audience. */
export const wasInvoiceSentTo = (
  summary: Pick<InvoiceDeliverySummary, "sentTo">,
  audience: InvoiceEmailDeliveryAudience
): boolean => summary.sentTo.includes(audience);
