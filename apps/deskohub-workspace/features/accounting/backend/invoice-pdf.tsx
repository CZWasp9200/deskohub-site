import "server-only";

import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { Data, Effect } from "effect";
import type { ReactElement } from "react";
import type { InvoiceDocument } from "@/features/accounting/invoice";
import {
  getInvoicePresentation,
  type InvoicePresentation,
} from "@/features/accounting/invoice-presentation";
import { type Locale, m } from "@/features/i18n";
import {
  AccountingDocumentFooter,
  AccountingDocumentHeader,
  AccountingDocumentVatNote,
  AccountingDocumentParties,
  renderAccountingDocumentPdf,
  accountingDocumentPdfStyles as styles,
} from "./accounting-document-pdf";
import {
  getInvoicePaymentRequest,
  type InvoicePaymentRequest,
} from "./invoice-payment-qr";

export class InvoicePdfRenderingError extends Data.TaggedError(
  "InvoicePdfRenderingError"
)<{
  readonly message: string;
}> {}

/** An issued invoice's PDF as a file to download, named by its number. */
export interface InvoicePdfFile {
  readonly bytes: Uint8Array;
  /** `<invoice number>.pdf`; invoice numbers are ASCII letters, digits and hyphens. */
  readonly fileName: string;
}

export const renderInvoicePdfFile = (
  document: InvoiceDocument
): Effect.Effect<InvoicePdfFile, InvoicePdfRenderingError> =>
  renderInvoicePdf(document).pipe(
    Effect.map(
      (bytes): InvoicePdfFile => ({
        bytes,
        fileName: `${document.invoiceNumber}.pdf`,
      })
    )
  );

export const renderInvoicePdf = (
  document: InvoiceDocument
): Effect.Effect<Buffer, InvoicePdfRenderingError> =>
  getInvoicePaymentRequest(document).pipe(
    Effect.mapError(
      () =>
        new InvoicePdfRenderingError({
          message: "Invoice payment QR code could not be rendered.",
        })
    ),
    Effect.flatMap((payment) =>
      renderAccountingDocumentPdf(
        <InvoicePdfDocument document={document} payment={payment} />,
        () =>
          new InvoicePdfRenderingError({
            message: "Invoice PDF could not be rendered.",
          })
      )
    ),
    Effect.withTracerEnabled(false)
  );

const InvoicePdfDocument = ({
  document,
  payment,
}: {
  readonly document: InvoiceDocument;
  readonly payment: InvoicePaymentRequest | null;
}): ReactElement => {
  const presentation = getInvoicePresentation(document);
  const issuedAt = new Date(document.issuedAt);

  return (
    <Document
      author={document.supplier.legalName}
      creationDate={issuedAt}
      creator="Deskohub Workspace"
      language={document.locale}
      modificationDate={issuedAt}
      subject={`${presentation.title} ${document.invoiceNumber}`}
      title={`${presentation.title} ${document.invoiceNumber}`}
    >
      <Page
        size="A4"
        style={payment ? [styles.page, styles.manualPage] : styles.page}
      >
        <AccountingDocumentHeader
          number={presentation.invoiceNumber}
          status={presentation.status}
          title={presentation.title}
        />

        <View style={styles.factColumns} wrap={false}>
          {presentation.factColumns.map((column) => (
            <View key={column[0].label} style={styles.factColumn}>
              {column.map((fact) =>
                fact ? (
                  <View key={fact.label} style={styles.fact}>
                    <Text style={styles.label}>{fact.label}</Text>
                    <Text style={styles.factValue}>{fact.value}</Text>
                  </View>
                ) : null
              )}
            </View>
          ))}
        </View>

        <AccountingDocumentParties
          buyer={presentation.buyer}
          supplier={presentation.supplier}
        />

        <InvoiceLines presentation={presentation} />

        {payment ? (
          <PaymentRequest payment={payment} locale={document.locale} />
        ) : null}

        <AccountingDocumentVatNote statement={presentation.vatStatement} />

        <AccountingDocumentFooter text={presentation.footer} />
      </Page>
    </Document>
  );
};

const PaymentRequest = ({
  payment,
  locale,
}: {
  readonly payment: InvoicePaymentRequest;
  readonly locale: Locale;
}): ReactElement => {
  const labels = {
    heading: m.invoicePaymentRequestHeading({}, { locale }),
    account: m.invoicePaymentRequestAccount({}, { locale }),
    iban: m.invoicePaymentRequestIban({}, { locale }),
    variableSymbol: m.invoicePaymentRequestVariableSymbol({}, { locale }),
    dueDate: m.invoicePaymentRequestDueDate({}, { locale }),
  };
  return (
    <View style={styles.paymentRequest} wrap={false}>
      <View style={styles.paymentDetails}>
        <Text style={styles.sectionHeading}>{labels.heading}</Text>
        <Text>{`${labels.account}: ${payment.accountNumber}`}</Text>
        <Text>{`${labels.iban}: ${payment.iban}`}</Text>
        <Text>{`BIC: ${payment.bic}`}</Text>
        <Text>{`${labels.variableSymbol}: ${payment.variableSymbol}`}</Text>
        <Text>{`${labels.dueDate}: ${payment.dueDate}`}</Text>
      </View>
      {payment.qrCode ? (
        <Image
          src={`data:image/png;base64,${payment.qrCode.toString("base64")}`}
          style={styles.paymentQr}
        />
      ) : null}
    </View>
  );
};

const InvoiceLines = ({
  presentation,
}: {
  readonly presentation: InvoicePresentation;
}): ReactElement => (
  <View style={styles.linesSection}>
    <View style={styles.lineHeader} fixed>
      <Text style={styles.lineDescription}>
        {presentation.lineDescriptionHeading}
      </Text>
      <Text style={styles.lineAmount}>{presentation.lineAmountHeading}</Text>
    </View>
    {presentation.lines.map((line, index) => (
      <View
        // biome-ignore lint/suspicious/noArrayIndexKey: Issued invoice lines are ordered and may contain duplicate descriptions and amounts.
        key={`${line.kind}-${index}`}
        style={line.kind === "discount" ? styles.discountLine : styles.line}
        wrap={false}
      >
        <Text style={styles.lineDescription}>{line.description}</Text>
        <Text style={styles.lineAmount}>{line.amount}</Text>
      </View>
    ))}
    <View style={styles.totalLine} wrap={false}>
      <Text style={styles.totalLabel}>{presentation.totalLabel}</Text>
      <Text style={styles.totalAmount}>{presentation.total}</Text>
    </View>
  </View>
);
