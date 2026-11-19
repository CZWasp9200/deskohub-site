import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import Archive from "lucide-react-native/icons/archive";
import Download from "lucide-react-native/icons/download";
import { StyleSheet, View } from "react-native";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import { DownloadShareFailure } from "../../customer-api/share-downloaded-file";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Icon } from "../../ui/icon";
import { ListGroup, ListRow } from "../../ui/list";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Notice } from "../../ui/notice";
import { Text } from "../../ui/text";
import { color, radius, space, touchTarget } from "../../ui/tokens";
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
export function DataExportRow({
  account,
  offer,
}: {
  readonly account: CustomerAccountState | undefined;
  readonly offer?: { readonly title: string; readonly description: string };
}) {
  const locale = useAppLocale();
  const result = useAtomValue(dataExportDownloadAtom);
  const download = useAtomSet(dataExportDownloadAtom);
  const row =
    account === undefined
      ? ({ kind: "idle" } as const)
      : dataExportRow(account, result);
  if (row.kind === "unavailable") {
    if (offer) return null;
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
  const downloadRow = (
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
  return offer ? (
    <View style={styles.offer}>
      <View style={styles.heading}>
        <View style={styles.icon}>
          <Icon icon={Download} color={color.onWarning} size={24} />
        </View>
        <View style={styles.copy}>
          <Text variant="bodyStrong" tone="warning" role="heading">
            {offer.title}
          </Text>
          <Text variant="bodySmall" tone="warning">
            {offer.description}
          </Text>
        </View>
      </View>
      {downloadRow}
    </View>
  ) : (
    downloadRow
  );
}

const styles = StyleSheet.create({
  offer: {
    backgroundColor: color.warningTint,
    borderColor: color.warning,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: space.md,
    padding: space.lg,
  },
  heading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.md,
  },
  icon: {
    alignItems: "center",
    backgroundColor: color.warning,
    borderRadius: radius.tile,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  copy: { flex: 1, gap: space.xxs },
});
