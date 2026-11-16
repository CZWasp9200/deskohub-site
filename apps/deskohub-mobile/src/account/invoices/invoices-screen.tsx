import type { CustomerInvoiceId } from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Match } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import Download from "lucide-react-native/icons/download";
import Receipt from "lucide-react-native/icons/receipt";
import { useState } from "react";
import { AsyncView } from "../../customer-api/async-view";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Card } from "../../ui/card";
import { LiveMessage } from "../../ui/controls";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { ListGroup, ListRow } from "../../ui/list";
import { listRowAccessibleLabel } from "../../ui/list-row-presentation";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { SkeletonGroup } from "../../ui/skeleton";
import { color } from "../../ui/tokens";
import { type InvoiceRow, invoiceRowText } from "./invoice-list-model";
import { InvoiceShareFailure } from "./invoice-pdf-share";
import {
  invoiceDownloadAtom,
  invoiceDownloadState,
  invoiceListAtom,
} from "./invoices-state";

/**
 * Invoices (board 38): the account's issued invoices, newest first, one row
 * each with what it was for, when and the total; tapping a row downloads
 * its PDF and hands it to the share sheet (a download on the web).
 */
export function InvoicesScreen() {
  const locale = useAppLocale();
  const list = useAtomValue(invoiceListAtom);
  const refresh = useAtomRefresh(invoiceListAtom);
  return (
    <ScrollScreen
      // The first load shows the skeleton alone.
      refreshing={list.waiting && !AsyncResult.isInitial(list)}
      onRefresh={refresh}
    >
      <AsyncView
        result={list}
        onRetry={refresh}
        loading={
          <SkeletonGroup rows={3} label={m.account_loading({}, { locale })} />
        }
      >
        {(loaded) =>
          loaded.kind === "empty" ? (
            <Card padding="none">
              <EmptyState
                icon={Receipt}
                title={m.invoices_empty({}, { locale })}
              />
            </Card>
          ) : (
            <InvoiceRows rows={loaded.rows} />
          )
        }
      </AsyncView>
    </ScrollScreen>
  );
}

function InvoiceRows({ rows }: { readonly rows: ReadonlyArray<InvoiceRow> }) {
  // The download tried last says how it went, above the list.
  const [attempted, setAttempted] = useState<InvoiceRow | undefined>();
  return (
    <>
      <DownloadOutcome row={attempted} />
      <ListGroup>
        {rows.map((row) => (
          <InvoiceListRow
            key={row.id}
            row={row}
            onDownload={() => setAttempted(row)}
          />
        ))}
      </ListGroup>
    </>
  );
}

function InvoiceListRow({
  row,
  onDownload,
}: {
  readonly row: InvoiceRow;
  readonly onDownload: () => void;
}) {
  const locale = useAppLocale();
  const download = useAtomSet(invoiceDownloadAtom(row.id));
  const state = invoiceDownloadState(useAtomValue(invoiceDownloadAtom(row.id)));
  const text = invoiceRowText(row, locale);
  const downloading = state.kind === "downloading";
  return (
    <ListRow
      kind="action"
      icon={Receipt}
      label={text.title}
      description={`${text.when}\n${text.amount}`}
      accessibilityLabel={listRowAccessibleLabel({
        label: m.invoices_download_label(
          { number: row.invoiceNumber },
          { locale }
        ),
        description: [text.title, text.when, text.amount].join(", "),
      })}
      trailing={
        downloading ? (
          <LoadingIndicator size="inline" tone="navy" />
        ) : (
          <Icon icon={Download} size={20} color={color.ink2} />
        )
      }
      disabled={downloading}
      onPress={() => {
        onDownload();
        download({ invoiceNumber: row.invoiceNumber });
      }}
    />
  );
}

const downloadFailureMessage = (
  failure: InvoiceShareFailure,
  locale: AppLocale
) =>
  InvoiceShareFailure.$match(failure, {
    Share: () => m.reservations_invoice_share_failed({}, { locale }),
    Download: ({ error }) =>
      Match.value(error).pipe(
        Match.tag("NotFound", () =>
          m.invoices_download_not_found({}, { locale })
        ),
        Match.orElse(
          (other) =>
            sharedViewErrorMessage(other, locale) ??
            m.account_error_unexpected({}, { locale })
        )
      ),
  });

/**
 * The progress and failure of the download tried last, announced as they
 * change; the screen has no download outcome to show before the first.
 */
function DownloadOutcome({ row }: { readonly row: InvoiceRow | undefined }) {
  return row === undefined ? null : (
    <AttemptedDownload id={row.id} invoiceNumber={row.invoiceNumber} />
  );
}

function AttemptedDownload({
  id,
  invoiceNumber,
}: {
  readonly id: CustomerInvoiceId;
  readonly invoiceNumber: string;
}) {
  const locale = useAppLocale();
  const state = invoiceDownloadState(useAtomValue(invoiceDownloadAtom(id)));
  return (
    <>
      <LiveMessage
        role="status"
        message={
          state.kind === "downloading"
            ? m.invoices_downloading({ number: invoiceNumber }, { locale })
            : undefined
        }
      />
      <Notice
        tone="error"
        message={
          state.kind === "failed"
            ? downloadFailureMessage(state.failure, locale)
            : undefined
        }
      />
    </>
  );
}
