import { Match } from "effect";
import type { Invoice } from "@/features/accounting/backend/invoice.repository";
import {
  type InvoiceDocument,
  type InvoiceNumber,
  isManualInvoiceDocument,
} from "@/features/accounting/invoice";
import {
  getInvoicePaymentStatus,
  getInvoiceSettlement,
  getInvoiceTotal,
  type InvoicePaymentStatus,
  type InvoiceTotal,
} from "@/features/accounting/invoice-settlement";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { workspaceSiteConstants } from "@/shared/utils";
import type { CsvColumn } from "@/shared/utils/csv";
import {
  type PlainDate,
  plainDateSpanToInstants,
  plainDateStringSchema,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";

/** The product an invoiced reservation booked. */
type InvoicedProduct =
  | { readonly kind: "cowork"; readonly tier: WorkspaceCoworkProductTier }
  | { readonly kind: "meeting-room" }
  | { readonly kind: "office" };

/**
 * What an invoiced reservation booked and the calendar span it invoices, as
 * its invoice froze them. `startsAt` and `endsAt` are ISO instants with
 * `endsAt` exclusive. A booking of whole days (cowork, office) invoices those
 * whole Prague days, midnight to midnight, whatever hours the space is open;
 * a meeting room keeps the instants it was booked for.
 */
export interface InvoicedReservation {
  readonly product: InvoicedProduct;
  readonly startsAt: string;
  readonly endsAt: string;
  /** The office's seats; `null` for a product booked without seats. */
  readonly seats: number | null;
}

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
  /** The due date while the invoice requests payment, else `null`. */
  readonly dueDate: PlainDate | null;
  /** What the invoiced reservation booked; `null` for a manual invoice. */
  readonly reservation: InvoicedReservation | null;
}

const workspaceDays = (startsOn: string, endsOn: string) => {
  const { startsAt, endsAt } = plainDateSpanToInstants({
    startsOn: Temporal.PlainDate.from(startsOn),
    endsOn: Temporal.PlainDate.from(endsOn),
    timeZone: workspaceSiteConstants.location.timeZone,
  });
  return { startsAt: startsAt.toString(), endsAt: endsAt.toString() };
};

/**
 * The reservation an issued document invoices, from the facts it froze at
 * checkout; a manual invoice invoices none.
 */
export const getInvoicedReservation = (
  document: InvoiceDocument
): InvoicedReservation | null => {
  if (isManualInvoiceDocument(document)) return null;
  return Match.value(document).pipe(
    Match.when(
      { reservation: { kind: "cowork" } },
      ({ reservation, quote }) => ({
        product: { kind: "cowork", tier: quote.items[0].tier } as const,
        ...workspaceDays(reservation.date, reservation.date),
        seats: null,
      })
    ),
    Match.when(
      { reservation: { kind: "meeting-room" } },
      ({ reservation }) => ({
        product: { kind: "meeting-room" } as const,
        startsAt: reservation.startsAt,
        endsAt: reservation.endsAt,
        seats: null,
      })
    ),
    Match.when({ reservation: { kind: "office" } }, ({ reservation }) => ({
      product: { kind: "office" } as const,
      ...workspaceDays(reservation.startsOn, reservation.endsOn),
      seats: reservation.seats,
    })),
    Match.exhaustive
  );
};

/** `today` is the workspace (Prague) calendar date. */
export const getCustomerInvoiceSummary = (
  invoice: Pick<
    Invoice,
    "id" | "workspaceReservationId" | "issuedAt" | "document"
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
  dueDate: Match.value(getInvoiceSettlement(invoice.document)).pipe(
    Match.tagsExhaustive({
      Paid: () => null,
      NothingDue: () => null,
      PaymentRequested: ({ dueDate }) => dueDate,
    })
  ),
  reservation: getInvoicedReservation(invoice.document),
});

export const getCustomerInvoiceStatusLabel = (
  status: InvoicePaymentStatus,
  locale: Locale
) =>
  ({
    paid: m.accountBillingInvoiceStatusPaid,
    issued: m.accountBillingInvoiceStatusIssued,
    due: m.accountBillingInvoiceStatusDue,
    overdue: m.accountBillingInvoiceStatusOverdue,
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
      getCustomerInvoiceStatusLabel(invoice.paymentStatus, locale),
  },
];
