import Download from "lucide-react-native/icons/download";
import Receipt from "lucide-react-native/icons/receipt";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Badge } from "../../ui/badge";
import { Button, ButtonRow } from "../../ui/controls";
import { Icon } from "../../ui/icon";
import { ListRow } from "../../ui/list";
import { listRowAccessibleLabel } from "../../ui/list-row-presentation";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { color, space } from "../../ui/tokens";
import {
  downloadableCreditNoteNumber,
  InvoiceDownload,
  type InvoiceRow,
  invoiceRowText,
} from "./invoice-list-model";

/**
 * One invoice of the list: what it was for, when and the total, marked
 * cancelled once a credit note negates it. Tapping it downloads its PDF. A
 * cancelled invoice whose credit note the Workspace serves offers two
 * downloads instead, its own PDF and the credit note's.
 */
export function InvoiceListRow({
  row,
  locale,
  downloading,
  held,
  onDownload,
}: {
  readonly row: InvoiceRow;
  readonly locale: AppLocale;
  /** Which of this row's documents is downloading, if any. */
  readonly downloading: InvoiceDownload["_tag"] | undefined;
  /** Some download runs, so no row starts another. */
  readonly held: boolean;
  readonly onDownload: (download: InvoiceDownload) => void;
}) {
  const text = invoiceRowText(row, locale);
  const status =
    row.cancellation === undefined
      ? undefined
      : m.invoices_status_cancelled({}, { locale });
  const badge =
    status === undefined ? undefined : <Badge tone="neutral" label={status} />;
  const description = `${text.when}\n${text.amount}`;
  const invoice = InvoiceDownload.Invoice({
    id: row.id,
    invoiceNumber: row.invoiceNumber,
  });
  const invoiceDownloadingLabel = m.invoices_downloading(
    { number: row.invoiceNumber },
    { locale }
  );
  const creditNoteNumber = downloadableCreditNoteNumber(row);

  if (creditNoteNumber !== undefined) {
    const creditNoteDownloadingLabel = m.invoices_credit_note_downloading(
      { number: creditNoteNumber },
      { locale }
    );
    return (
      <ListRow
        icon={Receipt}
        label={text.title}
        badge={badge}
        description={description}
        below={
          <View style={styles.downloads}>
            <ButtonRow>
              <Button
                variant="secondary"
                size="small"
                icon={Download}
                label={m.invoices_download_invoice_button({}, { locale })}
                accessibilityLabel={
                  downloading === "Invoice"
                    ? invoiceDownloadingLabel
                    : m.invoices_download_label(
                        { number: row.invoiceNumber },
                        { locale }
                      )
                }
                busy={downloading === "Invoice"}
                disabled={held && downloading !== "Invoice"}
                onPress={() => onDownload(invoice)}
              />
              <Button
                variant="secondary"
                size="small"
                icon={Download}
                label={m.invoices_download_credit_note_button({}, { locale })}
                accessibilityLabel={
                  downloading === "CreditNote"
                    ? creditNoteDownloadingLabel
                    : m.invoices_credit_note_download_label(
                        { number: creditNoteNumber },
                        { locale }
                      )
                }
                busy={downloading === "CreditNote"}
                disabled={held && downloading !== "CreditNote"}
                onPress={() =>
                  onDownload(
                    InvoiceDownload.CreditNote({
                      id: row.id,
                      correctiveDocumentNumber: creditNoteNumber,
                    })
                  )
                }
              />
            </ButtonRow>
          </View>
        }
      />
    );
  }

  return (
    <ListRow
      kind="action"
      icon={Receipt}
      label={text.title}
      badge={badge}
      description={description}
      // While it downloads, the row says so in place of its action.
      accessibilityLabel={listRowAccessibleLabel({
        label:
          downloading === "Invoice"
            ? invoiceDownloadingLabel
            : m.invoices_download_label(
                { number: row.invoiceNumber },
                { locale }
              ),
        description: [text.title, status, text.when, text.amount]
          .filter((part) => part !== undefined)
          .join(", "),
      })}
      trailing={
        downloading === "Invoice" ? (
          <LoadingIndicator
            size="inline"
            tone="navy"
            label={invoiceDownloadingLabel}
          />
        ) : (
          <Icon icon={Download} size={20} color={color.ink2} />
        )
      }
      disabled={held}
      onPress={() => onDownload(invoice)}
    />
  );
}

const styles = StyleSheet.create({
  downloads: { marginTop: space.md },
});
