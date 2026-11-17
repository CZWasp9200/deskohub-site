import "server-only";

import { join } from "node:path";
import {
  type DocumentProps,
  Font,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { Effect } from "effect";
import type { ReactElement } from "react";
import type { InvoicePresentationParty } from "@/features/accounting/invoice-presentation";

const accountingDocumentFontFamily = "Sculpin";
const accountingDocumentFontPath = join(
  process.cwd(),
  "assets",
  "fonts",
  "Sculpin",
  "regular.ttf"
);

Font.register({
  family: accountingDocumentFontFamily,
  fonts: [
    { src: accountingDocumentFontPath, fontWeight: 400 },
    { src: accountingDocumentFontPath, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

/**
 * Renders an accounting document's PDF without tracing, so no document
 * content reaches spans; a renderer failure becomes the caller's error.
 */
export const renderAccountingDocumentPdf = <E,>(
  document: ReactElement<DocumentProps>,
  onFailure: () => E
): Effect.Effect<Buffer, E> =>
  Effect.tryPromise({
    try: () => renderToBuffer(document),
    catch: onFailure,
  }).pipe(Effect.withTracerEnabled(false));

/** The brand eyebrow, title, number and status chip that open the page. */
export const AccountingDocumentHeader = ({
  title,
  number,
  status,
}: {
  readonly title: string;
  readonly number: string;
  readonly status: string;
}): ReactElement => (
  <View style={styles.header}>
    <View>
      <Text style={styles.eyebrow}>DESKOHUB WORKSPACE</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.invoiceNumber}>{number}</Text>
    </View>
    <Text style={styles.status}>{status}</Text>
  </View>
);

/** The supplier and buyer blocks, side by side. */
export const AccountingDocumentParties = ({
  supplier,
  buyer,
}: {
  readonly supplier: InvoicePresentationParty;
  readonly buyer: InvoicePresentationParty;
}): ReactElement => (
  <View style={styles.partyGrid} wrap={false}>
    <Party party={supplier} />
    <Party party={buyer} />
  </View>
);

const Party = ({
  party,
}: {
  readonly party: InvoicePresentationParty;
}): ReactElement => (
  <View style={styles.party}>
    <Text style={styles.sectionHeading}>{party.heading}</Text>
    <Text style={styles.partyName}>{party.name}</Text>
    {party.details.map((line) => (
      <Text key={line} style={styles.partyDetail}>
        {line}
      </Text>
    ))}
  </View>
);

/**
 * The VAT status statement the document was issued under; nothing when that
 * status has no statement.
 */
export const AccountingDocumentVatNote = ({
  statement,
}: {
  readonly statement: string | undefined;
}): ReactElement | null =>
  statement === undefined ? null : (
    <View style={styles.vatNote} wrap={false}>
      <Text>{statement}</Text>
    </View>
  );

/** The supplier line and page counter fixed to every page's foot. */
export const AccountingDocumentFooter = ({
  text,
}: {
  readonly text: string;
}): ReactElement => (
  <View fixed style={styles.footer}>
    <Text>{text}</Text>
    <Text
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
    />
  </View>
);

/** The page, header, party, line and note styles every accounting document shares. */
const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    color: "#152a3a",
    fontFamily: accountingDocumentFontFamily,
    fontSize: 10,
    lineHeight: 1.4,
    paddingBottom: 64,
    paddingHorizontal: 46,
    paddingTop: 42,
  },
  manualPage: {
    fontSize: 9,
    paddingBottom: 44,
    paddingTop: 24,
  },
  header: {
    alignItems: "flex-start",
    borderBottomColor: "#dce3e7",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    paddingBottom: 20,
  },
  eyebrow: {
    color: "#d15a35",
    fontSize: 9,
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1.05,
  },
  invoiceNumber: {
    color: "#536773",
    fontSize: 11,
    marginTop: 7,
  },
  status: {
    backgroundColor: "#dff2ea",
    borderRadius: 12,
    color: "#176b50",
    fontSize: 9,
    fontWeight: 700,
    paddingHorizontal: 12,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  factColumns: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 26,
  },
  factColumn: {
    flexBasis: 0,
    flexGrow: 1,
    gap: 13,
  },
  fact: {
    paddingRight: 18,
  },
  label: {
    color: "#70818b",
    fontSize: 8,
    marginBottom: 3,
    textTransform: "uppercase",
  },
  factValue: {
    fontSize: 10,
    fontWeight: 700,
  },
  partyGrid: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 28,
  },
  party: {
    backgroundColor: "#f5f7f8",
    borderRadius: 5,
    minHeight: 120,
    padding: 16,
    width: "50%",
  },
  sectionHeading: {
    color: "#d15a35",
    fontSize: 8,
    letterSpacing: 1.2,
    marginBottom: 9,
    textTransform: "uppercase",
  },
  partyName: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 5,
  },
  partyDetail: {
    color: "#455b68",
    fontSize: 9,
    marginBottom: 1,
  },
  linesSection: {
    marginBottom: 20,
  },
  lineHeader: {
    borderBottomColor: "#9eacb4",
    borderBottomWidth: 1,
    color: "#70818b",
    flexDirection: "row",
    fontSize: 8,
    paddingBottom: 7,
    textTransform: "uppercase",
  },
  line: {
    borderBottomColor: "#e5eaed",
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingVertical: 10,
  },
  discountLine: {
    borderBottomColor: "#e5eaed",
    borderBottomWidth: 1,
    color: "#176b50",
    flexDirection: "row",
    paddingVertical: 10,
  },
  lineDescription: {
    paddingRight: 16,
    width: "74%",
  },
  lineAmount: {
    textAlign: "right",
    width: "26%",
  },
  totalLine: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: 14,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: 700,
    marginRight: 16,
  },
  totalAmount: {
    color: "#d15a35",
    fontSize: 18,
    fontWeight: 700,
    minWidth: 120,
    textAlign: "right",
  },
  vatNote: {
    backgroundColor: "#fff6ed",
    borderLeftColor: "#d15a35",
    borderLeftWidth: 3,
    color: "#70442f",
    fontSize: 9,
    marginTop: 8,
    padding: 11,
  },
  paymentRequest: {
    alignItems: "center",
    backgroundColor: "#f5f7f8",
    borderRadius: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    padding: 10,
  },
  paymentDetails: {
    gap: 3,
  },
  paymentQr: {
    height: 88,
    width: 88,
  },
  footer: {
    bottom: 22,
    color: "#81909a",
    flexDirection: "row",
    fontSize: 8,
    justifyContent: "space-between",
    left: 46,
    position: "absolute",
    right: 46,
  },
});

export { styles as accountingDocumentPdfStyles };
