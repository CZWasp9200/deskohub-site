import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import Archive from "lucide-react-native/icons/archive";
import Download from "lucide-react-native/icons/download";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import { DownloadShareFailure } from "../../customer-api/share-downloaded-file";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Icon } from "../../ui/icon";
import { ListGroup, ListRow } from "../../ui/list";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Notice } from "../../ui/notice";
import { color } from "../../ui/tokens";
import { dataExportDownloadAtom, dataExportRow } from "./data-export";

const failureMessage = (failure: DownloadShareFailure, locale: AppLocale) =>
  DownloadShareFailure.$match(failure, {
    Share: () => m.legal_data_download_failed({}, { locale }),
    Download: ({ error }) =>
      sharedViewErrorMessage(error, locale) ??
      m.account_error_unexpected({}, { locale }),
  });

/**
 * "Download your data": the account's personal data archive, a ZIP the
 * share sheet takes (a download on the web). Until the account is read the
 * row offers it; the server decides who may download.
 */
export function DataExportRow() {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const result = useAtomValue(dataExportDownloadAtom);
  const download = useAtomSet(dataExportDownloadAtom);
  const row = AsyncResult.isSuccess(account)
    ? dataExportRow(account.value, result)
    : ({ kind: "idle" } as const);
  if (row.kind === "unavailable") {
    return (
      <ListGroup>
        <ListRow
          icon={Archive}
          label={m.legal_archive_unavailable({}, { locale })}
        />
      </ListGroup>
    );
  }
  const label = m.legal_data_download({}, { locale });
  const downloading = row.kind === "downloading";
  return (
    <>
      <ListGroup>
        <ListRow
          kind="action"
          icon={Archive}
          label={label}
          description={m.legal_data_download_format({}, { locale })}
          trailing={
            downloading ? (
              <LoadingIndicator size="inline" tone="navy" label={label} />
            ) : (
              <Icon icon={Download} size={20} color={color.ink2} />
            )
          }
          disabled={downloading}
          onPress={() => download(undefined)}
        />
      </ListGroup>
      {/* Kept mounted so assistive tech announces each failure. */}
      <Notice
        tone="error"
        message={
          row.kind === "failed"
            ? failureMessage(row.failure, locale)
            : undefined
        }
      />
    </>
  );
}
