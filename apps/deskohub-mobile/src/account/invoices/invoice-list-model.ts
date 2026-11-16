import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import type {
  CustomerInvoice,
  CustomerInvoiceId,
  CustomerInvoiceTotal,
} from "@deskohub/workspace-customer-api";
import { Data, Match, Option } from "effect";
import { formatPragueDate } from "../../booking/ui/prague-date-format";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstantRange, parseInstant } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";

/**
 * What an invoice was for: the booked product and when, once the invoice
 * list says so (ticket #1301). Until then every row is plain.
 */
export interface InvoiceSubject {
  readonly productName: string;
  /** The reservation's start and exclusive end, as ISO instants. */
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * The reservation's dates as a row line: whole Prague days as days, a
 * shorter span with its times; unreadable instants read as unavailable.
 */
const subjectDates = (
  { startsAt, endsAt }: InvoiceSubject,
  locale: AppLocale
): string =>
  Option.match(Option.all([parseInstant(startsAt), parseInstant(endsAt)]), {
    onNone: () => m.reservations_value_unavailable({}, { locale }),
    onSome: ([start, end]) => {
      const range = formatInstantRange(start, end, locale);
      return Option.match(range.end, {
        onNone: () => range.start,
        onSome: (last) =>
          m.reservations_time_range(
            { start: range.start, end: last },
            { locale }
          ),
      });
    },
  });

/**
 * One row of the invoice list, in one of two shapes. A described invoice
 * leads with what it was for and the reservation's dates (board 38); a
 * plain one with its number and the day it was issued. Both end with the
 * total as issued.
 */
export type InvoiceRow = Data.TaggedEnum<{
  Described: {
    readonly id: CustomerInvoiceId;
    readonly invoiceNumber: string;
    readonly total: CustomerInvoiceTotal;
    readonly subject: InvoiceSubject;
  };
  Plain: {
    readonly id: CustomerInvoiceId;
    readonly invoiceNumber: string;
    readonly total: CustomerInvoiceTotal;
    /** The Prague calendar date it was issued on. */
    readonly issuedOn: string;
  };
}>;
export const InvoiceRow = Data.taggedEnum<InvoiceRow>();

/** The row of an issued invoice, described when what it was for is known. */
export const invoiceRowOf = (
  { id, invoiceNumber, total, issuedOn }: CustomerInvoice,
  subject?: InvoiceSubject
): InvoiceRow =>
  subject === undefined
    ? InvoiceRow.Plain({ id, invoiceNumber, total, issuedOn })
    : InvoiceRow.Described({ id, invoiceNumber, total, subject });

/** What the invoice list shows once it has loaded. */
export type InvoiceList =
  | { readonly kind: "empty" }
  | { readonly kind: "list"; readonly rows: ReadonlyArray<InvoiceRow> };

/** The account's invoices as the list shows them, newest issue first. */
export const invoiceListOf = (
  invoices: ReadonlyArray<CustomerInvoice>
): InvoiceList =>
  invoices.length === 0
    ? { kind: "empty" }
    : { kind: "list", rows: invoices.map((invoice) => invoiceRowOf(invoice)) };

/** An invoice's total exactly as issued, such as "CZK 258.80" or "CZK 280". */
export const formatInvoiceTotal = (
  { amount, currency }: CustomerInvoiceTotal,
  locale: AppLocale
) => formatCurrencyAmount({ amount, currency, locale });

/** A row's three lines, worded for the locale. */
export interface InvoiceRowText {
  readonly title: string;
  readonly when: string;
  readonly amount: string;
}

export const invoiceRowText = (
  row: InvoiceRow,
  locale: AppLocale
): InvoiceRowText =>
  Match.valueTags(row, {
    Described: ({ subject, total, invoiceNumber }) => ({
      title: subject.productName,
      when: subjectDates(subject, locale),
      amount: m.invoices_row_amount_number(
        { amount: formatInvoiceTotal(total, locale), number: invoiceNumber },
        { locale }
      ),
    }),
    Plain: ({ invoiceNumber, issuedOn, total }) => ({
      title: invoiceNumber,
      when: formatPragueDate(issuedOn, locale, { dateStyle: "medium" }),
      amount: formatInvoiceTotal(total, locale),
    }),
  });

/**
 * The file name a shared invoice carries: its number, as the Workspace
 * names the download, with anything a file name can't hold replaced.
 */
export const invoicePdfName = (invoiceNumber: string) =>
  `${invoiceNumber.replace(/[^\p{L}\p{N}._-]+/gu, "-")}.pdf`;
