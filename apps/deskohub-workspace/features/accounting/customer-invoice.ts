import { Match } from "effect";
import type { Invoice } from "@/features/accounting/backend/invoice.repository";
import type { CorrectiveDocumentNumber } from "@/features/accounting/corrective-document";
import type { InvoiceNumber } from "@/features/accounting/invoice";
import {
  getInvoicePaymentStatus,
  getInvoiceSettlement,
  getInvoiceTotal,
  type InvoicePaymentStatus,
  type InvoiceTotal,
} from "@/features/accounting/invoice-settlement";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import { type Locale, m } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { workspaceSiteConstants } from "@/shared/utils";
import type { CsvColumn } from "@/shared/utils/csv";
import {
  type PlainDate,
  plainDateStringSchema,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";

/**
 * What a customer account shows of one issued invoice. Every fact comes from
 * the issued invoice; no current customer or catalog data joins it.
 */
export interface CustomerInvoiceSummary {
  readonly id: InvoiceId;
  readonly invoiceNumber: InvoiceNumber;
  /** The reservation it invoices; `null` for a manual invoice. */
  readonly workspaceReservationId: WorkspaceReservationId | null;
  /** The workspace (Prague) calendar date the invoice was issued on. */
  readonly issuedOn: PlainDate;
  readonly total: InvoiceTotal;
  readonly paymentStatus: InvoicePaymentStatus;
  /** The due date while the invoice requests payment, else `null`, also once it's cancelled. */
  readonly dueDate: PlainDate | null;
  /**
   * The corrective document that cancelled the invoice, else `null`. A
   * cancelled invoice stays listed, and its own document is unchanged.
   */
  readonly cancellation: {
    readonly correctiveDocumentNumber: CorrectiveDocumentNumber;
  } | null;
}

/**
 * What the account shows as an invoice's status: `cancelled` replaces the
 * payment status, which no longer asks the customer for anything.
 */
export type CustomerInvoiceStatus = InvoicePaymentStatus | "cancelled";

/** `today` is the workspace (Prague) calendar date. */
export const getCustomerInvoiceSummary = (
  invoice: Pick<
    Invoice,
    "id" | "workspaceReservationId" | "issuedAt" | "document" | "cancellation"
  >,
  today: PlainDate
): CustomerInvoiceSummary => ({
  id: invoice.id,
  invoiceNumber: invoice.document.invoiceNumber,
  workspaceReservationId:
    invoice.workspaceReservationId === null
      ? null
      : workspaceReservationIdSchema.make(invoice.workspaceReservationId),
  issuedOn: plainDateStringSchema.make(
    temporalInstantToPlainDate({
      instant: invoice.issuedAt,
      timeZone: workspaceSiteConstants.location.timeZone,
    }).toString()
  ),
  total: getInvoiceTotal(invoice.document),
  paymentStatus: getInvoicePaymentStatus(invoice.document, today),
  // A cancelled invoice requests no payment any more.
  dueDate: invoice.cancellation
    ? null
    : Match.value(getInvoiceSettlement(invoice.document)).pipe(
        Match.tagsExhaustive({
          Paid: () => null,
          NothingDue: () => null,
          PaymentRequested: ({ dueDate }) => dueDate,
        })
      ),
  // Archiving hides an invoice from the administration UI only, so an
  // archived invoice reads here like any other cancelled one.
  cancellation: invoice.cancellation && {
    correctiveDocumentNumber: invoice.cancellation.correctiveDocumentNumber,
  },
});

export const getCustomerInvoiceStatus = (
  invoice: Pick<CustomerInvoiceSummary, "paymentStatus" | "cancellation">
): CustomerInvoiceStatus =>
  invoice.cancellation === null ? invoice.paymentStatus : "cancelled";

export const getCustomerInvoiceStatusLabel = (
  status: CustomerInvoiceStatus,
  locale: Locale
) =>
  ({
    paid: m.accountBillingInvoiceStatusPaid,
    issued: m.accountBillingInvoiceStatusIssued,
    due: m.accountBillingInvoiceStatusDue,
    overdue: m.accountBillingInvoiceStatusOverdue,
    cancelled: m.accountBillingInvoiceStatusCancelled,
  })[status]({}, { locale });

/**
 * The customer's invoice export, one row per invoice. Dates stay ISO calendar
 * dates and totals exact decimals, so spreadsheets read them in any locale.
 */
export const getCustomerInvoiceCsvColumns = (
  locale: Locale
): readonly CsvColumn<CustomerInvoiceSummary>[] => [
  {
    header: m.accountBillingInvoiceColumnNumber({}, { locale }),
    value: (invoice) => invoice.invoiceNumber,
  },
  {
    header: m.accountBillingInvoiceColumnIssueDate({}, { locale }),
    value: (invoice) => invoice.issuedOn,
  },
  {
    header: m.accountBillingInvoiceColumnDueDate({}, { locale }),
    value: (invoice) => invoice.dueDate,
  },
  {
    header: m.accountBillingInvoiceColumnTotal({}, { locale }),
    value: (invoice) => invoice.total.amount,
  },
  {
    header: m.accountBillingInvoiceColumnCurrency({}, { locale }),
    value: (invoice) => invoice.total.currency,
  },
  {
    header: m.accountBillingInvoiceColumnStatus({}, { locale }),
    value: (invoice) =>
      getCustomerInvoiceStatusLabel(getCustomerInvoiceStatus(invoice), locale),
  },
  {
    header: m.accountBillingInvoiceColumnCorrectiveDocument({}, { locale }),
    value: (invoice) => invoice.cancellation?.correctiveDocumentNumber ?? null,
  },
];
