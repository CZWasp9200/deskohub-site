import Download from "lucide-react-native/icons/download";
import Receipt from "lucide-react-native/icons/receipt";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Badge } from "../../ui/badge";
import { Icon } from "../../ui/icon";
import { ListRow } from "../../ui/list";
import { listRowAccessibleLabel } from "../../ui/list-row-presentation";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { color } from "../../ui/tokens";
import { type InvoiceRow, invoiceRowText } from "./invoice-list-model";

/**
 * One invoice of the list: what it was for, when and the total, marked
 * cancelled once a credit note negates it. Tapping it downloads its PDF,
 * a cancelled invoice's too.
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
  /** This row's invoice is downloading. */
  readonly downloading: boolean;
  /** Some download runs, so no row starts another. */
  readonly held: boolean;
  readonly onDownload: () => void;
}) {
  const text = invoiceRowText(row, locale);
  const status = row.cancelled
    ? m.invoices_status_cancelled({}, { locale })
    : undefined;
  const downloadingLabel = m.invoices_downloading(
    { number: row.invoiceNumber },
    { locale }
  );
  return (
    <ListRow
      kind="action"
      icon={Receipt}
      label={text.title}
      badge={
        status === undefined ? undefined : (
          <Badge tone="neutral" label={status} />
        )
      }
      description={`${text.when}\n${text.amount}`}
      // While it downloads, the row says so in place of its action.
      accessibilityLabel={listRowAccessibleLabel({
        label: downloading
          ? downloadingLabel
          : m.invoices_download_label(
              { number: row.invoiceNumber },
              { locale }
            ),
        description: [text.title, status, text.when, text.amount]
          .filter((part) => part !== undefined)
          .join(", "),
      })}
      trailing={
        downloading ? (
          <LoadingIndicator
            size="inline"
            tone="navy"
            label={downloadingLabel}
          />
        ) : (
          <Icon icon={Download} size={20} color={color.ink2} />
        )
      }
      disabled={held}
      onPress={onDownload}
    />
  );
}
