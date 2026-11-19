import { Data } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { CorrectiveDocumentNumber } from "@/features/accounting/corrective-document";
import {
  type InvoiceDeliverySummary,
  type InvoiceEmailDeliveryState,
  wasInvoiceSentTo,
} from "@/features/accounting/invoice-email-delivery";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { AdministrationSource } from "@/features/administrators/administration-source";

/**
 * Why an invoice was cancelled: an administrator cancelled the invoice
 * itself, or cancelled the reservation it bills.
 */
export const invoiceCancellationCauses = [
  "invoice_cancellation",
  "reservation_cancellation",
] as const;

export type InvoiceCancellationCause =
  (typeof invoiceCancellationCauses)[number];

/**
 * What every reader of an invoice learns about its cancellation. It carries
 * no actor, so customer reads can hold it.
 */
export interface InvoiceCancellationFact {
  readonly cancelledAt: Temporal.Instant;
  readonly cause: InvoiceCancellationCause;
  readonly correctiveDocumentNumber: CorrectiveDocumentNumber;
}

/**
 * The cancellation notice to one audience: `not_owed` until a notice is
 * claimed for it, then the state of its delivery.
 */
export type InvoiceNoticeStatus = "not_owed" | InvoiceEmailDeliveryState;

export interface InvoiceNoticeSummary {
  readonly customer: InvoiceNoticeStatus;
  readonly internal: InvoiceNoticeStatus;
  /** A notice failed, or its delivery outlived its lease. */
  readonly needsAttention: boolean;
}

/** The operator fact of a cancellation, as administration reads it. */
export interface InvoiceCancellationRecord extends InvoiceCancellationFact {
  readonly invoiceId: InvoiceId;
  readonly source: AdministrationSource;
  readonly actor: {
    /** `null` once the administrator's account is deleted. */
    readonly accountId: CustomerAccountId | null;
    /** The administrator's login email when they cancelled. */
    readonly email: string;
  };
  readonly correctiveDocumentIssuedAt: Temporal.Instant;
  readonly notices: InvoiceNoticeSummary;
}

/**
 * Whether cancelling the invoice owes the customer a cancellation notice: its
 * invoice email was ever accepted for them, or is being delivered to them.
 */
export const isCustomerCancellationNoticeOwed = (
  summary: Pick<InvoiceDeliverySummary, "customer" | "sentTo">
): boolean =>
  wasInvoiceSentTo(summary, "customer") || summary.customer === "processing";

export class InvoiceCancellationError extends Data.TaggedError(
  "InvoiceCancellationError"
)<{
  readonly code:
    | "not_found"
    | "reservation_confirmation_required"
    | "reservation_cancellation_in_progress"
    | "confirmation_stale"
    | "document_unavailable"
    | "persistence_failed";
  /** `null` when a reservation's invoice could not be looked up. */
  readonly invoiceId: InvoiceId | null;
  readonly message: string;
  readonly cause?: unknown;
}> {}
