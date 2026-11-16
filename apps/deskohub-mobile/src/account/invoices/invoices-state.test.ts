import { describe, expect, test } from "bun:test";
import type { CustomerInvoiceId } from "@deskohub/workspace-customer-api";
import { Cause, Effect } from "effect";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import { DeviceCapabilityFailed } from "../../customer-api/device-capabilities";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import {
  sampleInvoiceIds,
  sampleInvoices,
} from "../../customer-api/testing/sample-fixtures";
import { invoicePdfName } from "./invoice-list-model";
import { InvoiceShareFailure } from "./invoice-pdf-share";
import {
  invoiceDownloadAtom,
  invoiceDownloadState,
  invoiceListAtom,
} from "./invoices-state";

/** Runs one invoice's download as its row does, and settles its outcome. */
const download = async (
  data: ReturnType<typeof makeFakeCustomerData>,
  id: CustomerInvoiceId,
  invoiceNumber: string
) => {
  const atom = invoiceDownloadAtom(id);
  const unmount = data.registry.mount(atom);
  data.registry.set(atom, { invoiceNumber });
  expect(invoiceDownloadState(data.registry.get(atom))).toEqual({
    kind: "downloading",
  });
  await Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(data.registry)
    )
  );
  const state = invoiceDownloadState(data.registry.get(atom));
  unmount();
  return state;
};

describe("invoiceListAtom", () => {
  test("lists the account's invoices newest first, one row each", async () => {
    const { registry } = makeFakeCustomerData("linked");

    const result = await settle(registry, invoiceListAtom);

    expect(result._tag).toBe("Success");
    const list = result._tag === "Success" ? result.success : undefined;
    expect(list?.kind).toBe("list");
    expect(list?.kind === "list" ? list.rows.map((row) => row.id) : []).toEqual(
      sampleInvoices().map(({ invoice }) => invoice.id)
    );
  });

  test("an account without invoices gets the empty list", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    workspace.data = { ...workspace.data, invoices: [] };
    const { registry } = makeFakeCustomerData("linked", workspace);

    expect(await settle(registry, invoiceListAtom)).toMatchObject({
      _tag: "Success",
      success: { kind: "empty" },
    });
  });

  test("a failed read fails the list, so the screen offers a retry", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    workspace.fail("listInvoices", "service-unavailable");
    const { registry } = makeFakeCustomerData("linked", workspace);

    expect((await settle(registry, invoiceListAtom))._tag).toBe("Failure");
  });
});

describe("invoiceDownloadAtom", () => {
  const [desk] = sampleInvoices();
  if (desk === undefined) throw new Error("the sample has invoices");

  test("hands the PDF to the share sheet under the invoice's number, then rests", async () => {
    const data = makeFakeCustomerData("linked");

    const state = await download(
      data,
      desk.invoice.id,
      desk.invoice.invoiceNumber
    );

    expect(state).toEqual({ kind: "idle" });
    expect(data.device.sharedFiles).toEqual([
      expect.objectContaining({
        name: invoicePdfName(desk.invoice.invoiceNumber),
        mimeType: "application/pdf",
      }),
    ]);
    expect(data.device.files.size).toBe(0);
  });

  test("an invoice the Workspace can't find fails the download and shares nothing", async () => {
    const data = makeFakeCustomerData("linked");

    const state = await download(data, sampleInvoiceIds.office, "2026-0341");

    expect(state).toEqual({
      kind: "failed",
      failure: InvoiceShareFailure.Download({
        error: CustomerViewError.NotFound(),
      }),
    });
    expect(data.device.sharedFiles).toEqual([]);
    expect(data.device.files.size).toBe(0);
  });

  test("a failed download can be told apart from a device that can't share", () => {
    expect(
      invoiceDownloadState(
        AsyncResult.failure(
          Cause.fail(new DeviceCapabilityFailed({ capability: "share" }))
        )
      )
    ).toEqual({ kind: "failed", failure: InvoiceShareFailure.Share() });
    expect(invoiceDownloadState(AsyncResult.initial())).toEqual({
      kind: "idle",
    });
  });
});

describe("invoicePdfName", () => {
  test("keeps the number and replaces what a file name can't hold", () => {
    expect(invoicePdfName("2026-0412")).toBe("2026-0412.pdf");
    expect(invoicePdfName("FV 2026/0412")).toBe("FV-2026-0412.pdf");
  });
});
