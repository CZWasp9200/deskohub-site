import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Match } from "effect";
import { AsyncResult } from "effect/reactivity";
import Download from "lucide-react-native/icons/download";
import Receipt from "lucide-react-native/icons/receipt";
import { useState } from "react";
import { AsyncView } from "../../customer-api/async-view";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import { DownloadShareFailure } from "../../customer-api/share-downloaded-file";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Card } from "../../ui/card";
import { EmptyState } from "../../ui/empty-state";
import { ListGroup } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { SkeletonGroup } from "../../ui/skeleton";
import type { InvoiceRow } from "./invoice-list-model";
import { InvoiceListRow } from "./invoice-list-row";
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
  const list = useAtomValue(invoiceListAtom(locale));
  const refresh = useAtomRefresh(invoiceListAtom(locale));
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

/**
 * The rows and the download they share: one at a time, every row held
 * while one downloads, the last one's progress and failure above the list.
 */
function InvoiceRows({ rows }: { readonly rows: ReadonlyArray<InvoiceRow> }) {
  const locale = useAppLocale();
  const download = useAtomSet(invoiceDownloadAtom);
  const state = invoiceDownloadState(useAtomValue(invoiceDownloadAtom));
  const [attempted, setAttempted] = useState<InvoiceRow | undefined>();
  const downloading = state.kind === "downloading";
  return (
    <>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice
        tone="error"
        message={
          state.kind === "failed"
            ? downloadFailureMessage(state.failure, locale)
            : undefined
        }
      />
      <ListGroup>
        {rows.map((row) => (
          <InvoiceListRow
            key={row.id}
            row={row}
            locale={locale}
            downloading={downloading && attempted?.id === row.id}
            held={downloading}
            onDownload={() => {
              setAttempted(row);
              download({ id: row.id, invoiceNumber: row.invoiceNumber });
            }}
          />
        ))}
      </ListGroup>
    </>
  );
}

const downloadFailureMessage = (
  failure: DownloadShareFailure,
  locale: AppLocale
) =>
  DownloadShareFailure.$match(failure, {
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
