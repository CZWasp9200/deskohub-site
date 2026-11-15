import { Context, type Effect } from "effect";
import type { InvoiceNoticeSummary } from "@/features/accounting/invoice-cancellation";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { InvoiceNoticeClaim } from "./invoice-cancellation.repository";
import type { InvoiceEmailDeliveryError } from "./invoice-email-sending";

export interface IInvoiceCancellationNotices {
  /**
   * Sends the cancellation notices claimed for the invoice, each with the
   * corrective document attached, and records each outcome on the notice
   * ledger. A failed notice stays retryable; it never undoes the
   * cancellation.
   */
  readonly deliver: (input: {
    readonly invoiceId: InvoiceId;
    readonly claims: readonly InvoiceNoticeClaim[];
  }) => Effect.Effect<
    { readonly changed: boolean; readonly notices: InvoiceNoticeSummary },
    InvoiceEmailDeliveryError
  >;
  /**
   * Claims and sends the customer's notice when the invoice is cancelled and
   * its original customer email was accepted after the cancellation was
   * recorded. Does nothing otherwise.
   */
  readonly ensureOwed: (
    invoiceId: InvoiceId
  ) => Effect.Effect<void, InvoiceEmailDeliveryError>;
}

/** Cancellation notice delivery; its implementation lives with the notice email. */
export class InvoiceCancellationNotices extends Context.Service<
  InvoiceCancellationNotices,
  IInvoiceCancellationNotices
>()("@deskohub-workspace/accounting/InvoiceCancellationNotices") {}
