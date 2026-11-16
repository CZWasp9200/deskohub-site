import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { Effect, Match } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import type { CustomerRequestFailure } from "../../customer-api/customer-view-error";
import type { DeviceCapabilityFailed } from "../../customer-api/device-capabilities";
import {
  DownloadShareFailure,
  downloadShareFailureOf,
  shareDownloadedFile,
} from "../../customer-api/share-downloaded-file";

/**
 * The name the shared archive carries. The contract gives only the bytes,
 * not the server's dated file name, so the app names it without a date.
 */
export const dataExportFileName = "deskohub-account-data.zip";

/**
 * Downloads the account's personal data archive (GET /account/data-export)
 * and hands it to the share sheet, a download on the web. The server decides
 * who may download; it answers 404 when this account can't.
 */
export const downloadDataExport = shareDownloadedFile(
  { name: dataExportFileName, mimeType: "application/zip" },
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.account.getDataExport()
  ).pipe(customerRead({ accountRead: false }))
).pipe(Effect.withSpan("Account.downloadDataExport"));

export const dataExportDownloadAtom = customerDataRuntime.fn(
  () => downloadDataExport
);

/** The "Download your data" row, as the Legal screen shows it. */
export type DataExportRow =
  /** The account has no customer of its own, so it has no archive to give. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "idle" }
  | { readonly kind: "downloading" }
  | { readonly kind: "failed"; readonly failure: DownloadShareFailure };

/**
 * The row for the account and the last download: a linked account is offered
 * the download until the server says this account can't have one (404).
 */
export const dataExportRow = (
  account: CustomerAccountState,
  result: AsyncResult.AsyncResult<
    void,
    CustomerRequestFailure | DeviceCapabilityFailed
  >
): DataExportRow => {
  if (account.kind !== "linked") return { kind: "unavailable" };
  if (result.waiting) return { kind: "downloading" };
  return Match.value(result).pipe(
    Match.tagsExhaustive({
      Initial: () => ({ kind: "idle" }) as const,
      // The share sheet took the file; nothing more to show.
      Success: () => ({ kind: "idle" }) as const,
      Failure: ({ cause }): DataExportRow => {
        const failure = downloadShareFailureOf(cause);
        return DownloadShareFailure.$is("Download")(failure) &&
          failure.error._tag === "NotFound"
          ? { kind: "unavailable" }
          : { kind: "failed", failure };
      },
    })
  );
};
