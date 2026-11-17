import "server-only";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { Data, Effect } from "effect";
import type { ReactElement } from "react";
import type { CorrectiveDocument } from "@/features/accounting/corrective-document";
import { getCorrectiveDocumentPresentation } from "@/features/accounting/corrective-document-presentation";
import {
  AccountingDocumentFooter,
  AccountingDocumentHeader,
  AccountingDocumentVatNote,
  AccountingDocumentParties,
  renderAccountingDocumentPdf,
  accountingDocumentPdfStyles as styles,
} from "./accounting-document-pdf";

export class CorrectiveDocumentPdfRenderingError extends Data.TaggedError(
  "CorrectiveDocumentPdfRenderingError"
)<{
  readonly message: string;
}> {}

/** A corrective document's PDF as a file to download, named by its number. */
export interface CorrectiveDocumentPdfFile {
  readonly bytes: Uint8Array;
  /** `<document number>.pdf`; the number is ASCII letters, digits and hyphens. */
  readonly fileName: string;
}

/**
 * Renders the corrective document's PDF on demand from its stored document
 * alone; like the invoice PDF, it is never persisted.
 */
export const renderCorrectiveDocumentPdfFile = (
  document: CorrectiveDocument
): Effect.Effect<
  CorrectiveDocumentPdfFile,
  CorrectiveDocumentPdfRenderingError
> =>
  renderAccountingDocumentPdf(
    <CorrectiveDocumentPdfDocument document={document} />,
    () =>
      new CorrectiveDocumentPdfRenderingError({
        message: "Corrective document PDF could not be rendered.",
      })
  ).pipe(
    Effect.map(
      (bytes): CorrectiveDocumentPdfFile => ({
        bytes,
        fileName: `${document.documentNumber}.pdf`,
      })
    )
  );

const CorrectiveDocumentPdfDocument = ({
  document,
}: {
  readonly document: CorrectiveDocument;
}): ReactElement => {
  const presentation = getCorrectiveDocumentPresentation(document);
  const issuedAt = new Date(document.issuedAt);
  const title = `${presentation.title} ${document.documentNumber}`;

  return (
    <Document
      author={document.supplier.legalName}
      creationDate={issuedAt}
      creator="Deskohub Workspace"
      language={document.locale}
      modificationDate={issuedAt}
      subject={title}
      title={title}
    >
      <Page size="A4" style={[styles.page, styles.manualPage]}>
        <AccountingDocumentHeader
          number={presentation.documentNumber}
          status={presentation.status}
          title={presentation.title}
        />

        <Text style={correctiveStyles.reference}>{presentation.reference}</Text>

        <View style={styles.factColumns} wrap={false}>
          {presentation.factColumns.map((column) => (
            <View key={column[0].label} style={styles.factColumn}>
              {column.map((fact) => (
                <View key={fact.label} style={styles.fact}>
                  <Text style={styles.label}>{fact.label}</Text>
                  <Text style={styles.factValue}>{fact.value}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <AccountingDocumentParties
          buyer={presentation.buyer}
          supplier={presentation.supplier}
        />

        <View style={styles.linesSection}>
          <View style={styles.lineHeader} fixed>
            <Text style={styles.lineDescription}>
              {presentation.lineDescriptionHeading}
            </Text>
            <Text style={styles.lineAmount}>
              {presentation.lineAmountHeading}
            </Text>
          </View>
          {presentation.lines.map((line, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: Corrective document lines are ordered and may repeat descriptions and amounts.
              key={index}
              style={styles.line}
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

        <View style={correctiveStyles.settlement} wrap={false}>
          <Text>{presentation.settlement}</Text>
        </View>

        <AccountingDocumentVatNote
          statement={presentation.vatStatement}
        />

        <AccountingDocumentFooter text={presentation.footer} />
      </Page>
    </Document>
  );
};

const correctiveStyles = StyleSheet.create({
  reference: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 16,
    marginTop: -8,
  },
  settlement: {
    backgroundColor: "#f5f7f8",
    borderRadius: 5,
    fontSize: 10,
    marginBottom: 4,
    padding: 11,
  },
});
