import { describe, expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import { DeviceCapabilityFailed } from "../../customer-api/device-capabilities";
import { DownloadShareFailure } from "../../customer-api/share-downloaded-file";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import {
  sampleInvoiceIds,
  sampleInvoices,
} from "../../customer-api/testing/sample-fixtures";
import { InvoiceDownload, invoicePdfName } from "./invoice-list-model";
import {
  invoiceDownloadAtom,
  invoiceDownloadState,
  invoiceListAtom,
} from "./invoices-state";

/** Runs one document's download as its row does, and settles its outcome. */
const download = async (
  data: ReturnType<typeof makeFakeCustomerData>,
  document: InvoiceDownload
) => {
  data.registry.set(invoiceDownloadAtom, document);
  expect(invoiceDownloadState(data.registry.get(invoiceDownloadAtom))).toEqual({
    kind: "downloading",
  });
  await Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(invoiceDownloadAtom, { suspendOnWaiting: true })(
        data.registry
      )
    )
  );
  return invoiceDownloadState(data.registry.get(invoiceDownloadAtom));
};

/** A registry with the screen's download mounted, as while the list shows. */
const withDownloads = () => {
  const data = makeFakeCustomerData("linked");
  data.registry.mount(invoiceDownloadAtom);
  return data;
};

describe("invoiceListAtom", () => {
  test("lists the account's invoices newest first, one row each", async () => {
    const { registry } = makeFakeCustomerData("linked");

    const result = await settle(registry, invoiceListAtom("en-US"));

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

    expect(await settle(registry, invoiceListAtom("en-US"))).toMatchObject({
      _tag: "Success",
      success: { kind: "empty" },
    });
  });

  test("a failed read fails the list, so the screen offers a retry", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    workspace.fail("listInvoices", "service-unavailable");
    const { registry } = makeFakeCustomerData("linked", workspace);

    expect((await settle(registry, invoiceListAtom("en-US")))._tag).toBe(
      "Failure"
    );
  });
});

describe("invoiceDownloadAtom", () => {
  const [desk] = sampleInvoices();
  const cancelled = sampleInvoices().find(
    ({ invoice }) => invoice.id === sampleInvoiceIds.cancelled
  );
  const correctiveDocumentNumber =
    cancelled?.invoice.cancellation?.correctiveDocumentNumber;
  if (desk === undefined || correctiveDocumentNumber === undefined)
    throw new Error("the sample has invoices in force and cancelled");
  const deskInvoice = InvoiceDownload.Invoice({
    id: desk.invoice.id,
    invoiceNumber: desk.invoice.invoiceNumber,
  });
  const officeInvoice = InvoiceDownload.Invoice({
    id: sampleInvoiceIds.office,
    invoiceNumber: "2026-0341",
  });
  const creditNote = InvoiceDownload.CreditNote({
    id: sampleInvoiceIds.cancelled,
    correctiveDocumentNumber,
  });

  test("hands the PDF to the share sheet under the invoice's number, then rests", async () => {
    const data = withDownloads();

    const state = await download(data, deskInvoice);

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
    const data = withDownloads();

    const state = await download(data, officeInvoice);

    expect(state).toEqual({
      kind: "failed",
      failure: DownloadShareFailure.Download({
        error: CustomerViewError.NotFound(),
      }),
    });
    expect(data.device.sharedFiles).toEqual([]);
    expect(data.device.files.size).toBe(0);
  });

  test("the next download replaces the last one's failure", async () => {
    const data = withDownloads();

    expect((await download(data, officeInvoice)).kind).toBe("failed");
    expect(await download(data, deskInvoice)).toEqual({ kind: "idle" });
    expect(data.device.sharedFiles).toHaveLength(1);
  });

  test("hands a cancelled invoice's credit note to the share sheet under the credit note's number", async () => {
    const data = withDownloads();

    const state = await download(data, creditNote);

    expect(state).toEqual({ kind: "idle" });
    expect(data.device.sharedFiles).toEqual([
      expect.objectContaining({
        name: invoicePdfName(correctiveDocumentNumber),
        mimeType: "application/pdf",
      }),
    ]);
    expect(data.device.files.size).toBe(0);
  });

  test("the credit note of an invoice that isn't cancelled is not found, as an unknown invoice", async () => {
    const data = withDownloads();

    const state = await download(
      data,
      InvoiceDownload.CreditNote({
        id: desk.invoice.id,
        correctiveDocumentNumber,
      })
    );

    expect(state).toEqual({
      kind: "failed",
      failure: DownloadShareFailure.Download({
        error: CustomerViewError.NotFound(),
      }),
    });
    expect(data.device.sharedFiles).toEqual([]);
  });

  test("a failed credit note download fails the list's one download, until the next replaces it", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    workspace.fail("getCorrectiveDocumentPdf", "service-unavailable");
    const data = makeFakeCustomerData("linked", workspace);
    data.registry.mount(invoiceDownloadAtom);

    expect((await download(data, creditNote)).kind).toBe("failed");
    expect(await download(data, deskInvoice)).toEqual({ kind: "idle" });
    expect(data.device.sharedFiles).toHaveLength(1);
  });

  test("a failed download can be told apart from a device that can't share", () => {
    expect(
      invoiceDownloadState(
        AsyncResult.failure(
          Cause.fail(new DeviceCapabilityFailed({ capability: "share" }))
        )
      )
    ).toEqual({ kind: "failed", failure: DownloadShareFailure.Share() });
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
