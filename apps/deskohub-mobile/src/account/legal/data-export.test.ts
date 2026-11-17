import { describe, expect, test } from "bun:test";
import { CustomerDataExportUnavailable } from "@deskohub/workspace-customer-api";
import { Cause, Effect, Exit, Layer } from "effect";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  DeviceCapabilityFailed,
  ShareSheet,
} from "../../customer-api/device-capabilities";
import { DownloadShareFailure } from "../../customer-api/share-downloaded-file";
import { makeFakeCustomerData } from "../../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import {
  dataExportDownloadAtom,
  dataExportFileName,
  dataExportRow,
  downloadDataExport,
} from "./data-export";

const linked = FakeWorkspace.forKind("linked").data.account;

/** Runs the row's download as its button does, and settles the row. */
const download = async (data: ReturnType<typeof makeFakeCustomerData>) => {
  data.registry.mount(dataExportDownloadAtom);
  data.registry.set(dataExportDownloadAtom, undefined);
  expect(
    dataExportRow(linked, data.registry.get(dataExportDownloadAtom))
  ).toEqual({ kind: "downloading" });
  await Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(dataExportDownloadAtom, {
        suspendOnWaiting: true,
      })(data.registry)
    )
  );
  return dataExportRow(linked, data.registry.get(dataExportDownloadAtom));
};

describe("downloadDataExport", () => {
  test("hands the server's archive to the share sheet as a ZIP, then removes the file", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const device = makeFakeDevice();
    const shared: Array<{ name: string; mimeType: string; bytes: number[] }> =
      [];
    const sheet = Layer.succeed(ShareSheet, {
      shareFile: (file) =>
        Effect.sync(() => {
          shared.push({
            name: file.name,
            mimeType: file.mimeType,
            bytes: [...(device.files.get(file.uri) ?? [])],
          });
        }),
      shareLink: () => Effect.void,
    });

    const exit = await Effect.runPromise(
      Effect.exit(
        downloadDataExport.pipe(
          Effect.provide(
            Layer.mergeAll(fakeCustomerDataLayer({ workspace, device }), sheet)
          )
        )
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shared).toHaveLength(1);
    const [file] = shared;
    expect(file?.name).toBe(dataExportFileName);
    expect(file?.mimeType).toBe("application/zip");
    // The bytes the server sent: a ZIP archive starts with "PK".
    expect(file?.bytes.slice(0, 2)).toEqual([0x50, 0x4b]);
    expect(device.files.size).toBe(0);
  });
});

describe("dataExportRow", () => {
  test("offers the download to a linked account, and rests after sharing", async () => {
    const data = makeFakeCustomerData("linked");

    expect(dataExportRow(linked, AsyncResult.initial())).toEqual({
      kind: "idle",
    });
    expect(await download(data)).toEqual({ kind: "idle" });
    expect(data.device.sharedFiles).toHaveLength(1);
  });

  test("an account without a linked customer has no archive to download", () => {
    for (const kind of [
      "completion-required",
      "deletion-pending",
      "authenticated-unavailable",
    ] as const) {
      const account = FakeWorkspace.forKind(kind).data.account;
      expect(dataExportRow(account, AsyncResult.initial())).toEqual({
        kind: "unavailable",
      });
    }
  });

  test("the server's 404 turns the row unavailable and shares nothing", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const data = makeFakeCustomerData("linked", workspace);
    // The server refuses this session's archive (as for a pending deletion).
    workspace.data = {
      ...workspace.data,
      account: FakeWorkspace.forKind("deletion-pending").data.account,
    };

    expect(await download(data)).toEqual({ kind: "unavailable" });
    expect(data.device.sharedFiles).toEqual([]);
    expect(
      dataExportRow(
        linked,
        AsyncResult.failure(Cause.fail(new CustomerDataExportUnavailable()))
      )
    ).toEqual({ kind: "unavailable" });
  });

  test("other failures keep the row with what went wrong", () => {
    expect(
      dataExportRow(
        linked,
        AsyncResult.failure(
          Cause.fail(new DeviceCapabilityFailed({ capability: "share" }))
        )
      )
    ).toEqual({ kind: "failed", failure: DownloadShareFailure.Share() });
  });

  test("a failed request keeps its view error", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    workspace.fail("getDataExport", "service-unavailable");
    const data = makeFakeCustomerData("linked", workspace);

    expect(await download(data)).toEqual({
      kind: "failed",
      failure: DownloadShareFailure.Download({
        error: CustomerViewError.Unavailable(),
      }),
    });
  });
});
