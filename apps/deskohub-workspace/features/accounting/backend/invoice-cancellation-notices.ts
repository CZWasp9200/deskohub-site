import { Context, Effect, Layer } from "effect";
import type { InvoiceNoticeSummary } from "@/features/accounting/invoice-cancellation";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { InvoiceNoticeClaim } from "./invoice-cancellation.repository";
import type { InvoiceEmailDeliveryError } from "./invoice-email-delivery.service";

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
>()("@deskohub-workspace/accounting/InvoiceCancellationNotices") {
  /**
   * PLACEHOLDER until the notice email lands: stream P2 replaces this line
   * with the real layer at integration. Every notice operation is a defect,
   * so a missed replacement cannot pass silently.
   */
  static Live = Layer.succeed(
    this,
    this.of({
      deliver: () =>
        Effect.die(new Error("Invoice cancellation notices are not wired.")),
      ensureOwed: () =>
        Effect.die(new Error("Invoice cancellation notices are not wired.")),
    })
  );
}
