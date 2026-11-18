import { BigDecimal, Match } from "effect";
import type { CorrectiveDocument } from "@/features/accounting/corrective-document";
import {
  formatDecimalAmount,
  formatDocumentInstant,
  getAccountingDocumentPartiesPresentation,
  getSupplierVatStatement,
  type InvoicePresentationParty,
} from "@/features/accounting/invoice-presentation";
import { type Locale, m } from "@/features/i18n";

interface CorrectiveDocumentPresentationFact {
  readonly label: string;
  readonly value: string;
}

/** What a corrective document prints, in its own locale. */
export interface CorrectiveDocumentPresentation {
  readonly locale: Locale;
  readonly title: string;
  readonly documentNumber: string;
  readonly status: string;
  readonly reference: string;
  readonly factColumns: readonly [
    readonly [
      CorrectiveDocumentPresentationFact,
      CorrectiveDocumentPresentationFact,
    ],
    readonly [
      CorrectiveDocumentPresentationFact,
      CorrectiveDocumentPresentationFact,
    ],
  ];
  readonly supplier: InvoicePresentationParty;
  readonly buyer: InvoicePresentationParty;
  readonly lineDescriptionHeading: string;
  readonly lineAmountHeading: string;
  readonly lines: readonly {
    readonly description: string;
    readonly amount: string;
  }[];
  readonly totalLabel: string;
  readonly total: string;
  readonly settlement: string;
  /** The VAT status statement of the invoice it corrects, if that status has one. */
  readonly vatStatement: string | undefined;
  readonly footer: string;
}

/**
 * The corrective document's printed presentation, built only from its stored
 * facts: the parties and lines it copied from the cancelled invoice, never
 * current data.
 */
export const getCorrectiveDocumentPresentation = (
  document: CorrectiveDocument
): CorrectiveDocumentPresentation => {
  const { locale } = document;
  const amount = (value: string) =>
    formatCorrectiveAmount(value, document.currency);
  const invoiceDate = formatDocumentInstant(
    document.correctedInvoice.issuedAt,
    locale
  );

  return {
    locale,
    title: m.correctiveDocumentTitle({}, { locale }),
    documentNumber: document.documentNumber,
    status: m.correctiveDocumentStatus({}, { locale }),
    reference: m.correctiveDocumentReference(
      { invoiceNumber: document.correctedInvoice.invoiceNumber, invoiceDate },
      { locale }
    ),
    factColumns: [
      [
        {
          label: m.correctiveDocumentNumberLabel({}, { locale }),
          value: document.documentNumber,
        },
        {
          label: m.correctiveDocumentCorrectedInvoiceLabel({}, { locale }),
          value: document.correctedInvoice.invoiceNumber,
        },
      ],
      [
        {
          label: m.correctiveDocumentIssueDateLabel({}, { locale }),
          value: formatDocumentInstant(document.issuedAt, locale),
        },
        {
          label: m.correctiveDocumentCauseLabel({}, { locale }),
          value: Match.value(document.cause).pipe(
            Match.when("invoice_cancellation", () =>
              m.correctiveDocumentCauseInvoiceCancellation({}, { locale })
            ),
            Match.when("reservation_cancellation", () =>
              m.correctiveDocumentCauseReservationCancellation({}, { locale })
            ),
            Match.exhaustive
          ),
        },
      ],
    ],
    ...getAccountingDocumentPartiesPresentation(document),
    lineDescriptionHeading: m.invoiceDescriptionLabel({}, { locale }),
    lineAmountHeading: m.invoiceAmountLabel({}, { locale }),
    lines: document.lines.map((line) => ({
      description: line.description,
      amount: amount(line.amount),
    })),
    totalLabel: m.invoiceManualTotal({}, { locale }),
    total: amount(document.total),
    settlement: getCorrectiveDocumentSettlementSentence(document),
    vatStatement: getSupplierVatStatement(document.supplier, locale),
    footer: `${document.supplier.legalName} · ${document.supplier.contactEmail}`,
  };
};

/**
 * What the corrective document means for the buyer's money: the paid total
 * goes back to them, or nothing is paid or refunded.
 */
export const getCorrectiveDocumentSettlementSentence = (
  document: Pick<
    CorrectiveDocument,
    "currency" | "locale" | "settlement" | "total"
  >
): string => {
  const { locale } = document;
  return Match.value(document.settlement).pipe(
    Match.when("refund_due", () =>
      m.correctiveDocumentSettlementRefundDue(
        {
          amount: formatDecimalAmount({
            amount: BigDecimal.format(
              BigDecimal.abs(BigDecimal.fromStringUnsafe(document.total))
            ),
            currency: document.currency,
          }),
        },
        { locale }
      )
    ),
    Match.when("nothing_due", () =>
      m.correctiveDocumentSettlementNothingDue({}, { locale })
    ),
    Match.exhaustive
  );
};

/** A negated amount prints with a minus sign, like an invoice discount. */
const formatCorrectiveAmount = (amount: string, currency: string) =>
  formatDecimalAmount({ amount, currency }).replace(/^-/, "−");
