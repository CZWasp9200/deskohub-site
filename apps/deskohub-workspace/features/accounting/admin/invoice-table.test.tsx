import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationDotyposCustomerId,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { cleanup, render, within } from "@testing-library/react";
import type { InvoiceNoticeSummary } from "@/features/accounting/invoice-cancellation";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { InvoiceAdministrationListItem } from "./invoice-administration.service";
import type { InvoiceAdministrationTableRow } from "./invoice-table";

mock.module("./actions", () => ({
  retryAdministrationInvoice: async () => ({}),
  previewAdministrationInvoiceCancellation: async () => ({}),
  cancelAdministrationInvoice: async () => ({}),
  archiveAdministrationInvoice: async () => ({}),
}));

let InvoiceAdministrationTable: typeof import("./invoice-table").InvoiceAdministrationTable;

beforeAll(async () => {
  registerWorkspaceComponentTestEnv();
  ({ InvoiceAdministrationTable } = await import("./invoice-table"));
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const invoice: InvoiceAdministrationTableRow = {
  id: AdministrationInvoiceId.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21"),
  invoiceNumber: "2026000001",
  issuedAt: "2026-08-18T10:30:00Z",
  issuedAtLabel: "18. 8. 2026 12:30",
  customerId: AdministrationDotyposCustomerId.make("1"),
  customerName: "Synthetic Customer",
  reservationId: null,
  total: "1000.00",
  totalLabel: "1 000 Kč",
  currency: "CZK",
  paymentStatus: "overdue",
  source: "admin-ui",
  actor: null,
  delivery: { customer: "failed", internal: "accepted" },
  needsAttention: true,
  cancellation: null,
  archivedAt: null,
  replacesInvoiceId: null,
  replacedByInvoiceId: null,
};

const cancelledInvoice: InvoiceAdministrationTableRow = {
  ...invoice,
  id: AdministrationInvoiceId.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22"),
  invoiceNumber: "2026000002",
  delivery: { customer: "accepted", internal: "accepted" },
  needsAttention: false,
  cancellation: {
    cancelledAt: "2026-08-20T10:00:00Z",
    cause: "invoice_cancellation",
    source: "admin-ui",
    actor: testEmailAddress("invoice-table-operator"),
    correctiveDocumentNumber: "WS-OD-2026-000001",
    correctiveDocumentIssuedAt: "2026-08-20T10:00:00Z",
    correctiveDocumentPdfUrl:
      "/admin/invoices/018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22/corrective-document" as never,
    notices: {
      customer: "accepted",
      internal: "accepted",
      needsAttention: false,
    },
  },
};

test("renders the invoice table in Czech on a Czech route", () => {
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <InvoiceAdministrationTable items={[invoice]} query={{}} />
    </RouteLocaleProvider>
  );

  expect(view.getByRole("table", { name: "Faktury" })).toBeTruthy();
  for (const header of ["Odběratel", "Vystaveno", "Celkem", "Původ"]) {
    expect(view.getByRole("columnheader", { name: header })).toBeTruthy();
  }
  expect(view.getAllByText("Po splatnosti").length).toBeGreaterThan(0);
  expect(view.getAllByText("Nutné znovu odeslat").length).toBeGreaterThan(0);
  expect(view.getAllByText("Administrace").length).toBeGreaterThan(0);
  expect(view.getByText("Vystaveno 18. 8. 2026 12:30")).toBeTruthy();
  expect(
    view.getAllByRole("button", { name: "Znovu odeslat 2026000001" }).length
  ).toBeGreaterThan(0);
});

test("marks only cancelled rows, which offer hiding instead of cancelling", () => {
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
  const locale = "en-US";
  const view = render(
    <RouteLocaleProvider locale={locale}>
      <InvoiceAdministrationTable
        items={[invoice, cancelledInvoice]}
        query={{}}
      />
    </RouteLocaleProvider>
  );
  const table = within(view.getByRole("table"));
  const rowOf = (invoiceNumber: string) =>
    within(
      table
        .getByRole("link", { name: invoiceNumber })
        .closest("tr") as HTMLElement
    );
  const badge = m.accountingInvoiceCancelledBadge({}, { locale });
  const cancel = (invoiceNumber: string) =>
    m.accountingInvoiceCancelLabel({ invoiceNumber }, { locale });
  const hide = (invoiceNumber: string) =>
    m.accountingInvoiceHideLabel({ invoiceNumber }, { locale });

  const live = rowOf(invoice.invoiceNumber);
  expect(live.queryByText(badge)).toBeNull();
  expect(
    live.getByRole("button", { name: cancel(invoice.invoiceNumber) })
  ).toBeTruthy();
  expect(
    live.queryByRole("button", { name: hide(invoice.invoiceNumber) })
  ).toBeNull();

  const cancelled = rowOf(cancelledInvoice.invoiceNumber);
  expect(cancelled.getByText(badge)).toBeTruthy();
  expect(
    cancelled.getByText(m.accountingInvoicePaymentOverdue({}, { locale }))
  ).toBeTruthy();
  expect(
    cancelled.getByRole("button", {
      name: hide(cancelledInvoice.invoiceNumber),
    })
  ).toBeTruthy();
  expect(
    cancelled.queryByRole("button", {
      name: cancel(cancelledInvoice.invoiceNumber),
    })
  ).toBeNull();
});

test("shows an invoice whose document cannot be read without its document's fields or actions, except hiding once cancelled", () => {
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
  const locale = "en-US";
  const unreadable: InvoiceAdministrationTableRow = {
    documentUnavailable: true,
    id: AdministrationInvoiceId.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23"),
    invoiceNumber: "2026000003",
    issuedAt: "2026-08-18T10:30:00Z",
    issuedAtLabel: "18. 8. 2026 12:30",
    cancelledAt: null,
    archivedAt: null,
    replacesInvoiceId: null,
    replacedByInvoiceId: null,
  };
  const cancelledUnreadable: InvoiceAdministrationTableRow = {
    ...unreadable,
    id: AdministrationInvoiceId.make("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb24"),
    invoiceNumber: "2026000004",
    cancelledAt: "2026-08-20T10:00:00Z",
  };
  const view = render(
    <RouteLocaleProvider locale={locale}>
      <InvoiceAdministrationTable
        items={[invoice, unreadable, cancelledUnreadable]}
        query={{}}
      />
    </RouteLocaleProvider>
  );
  const table = within(view.getByRole("table"));
  const rowOf = (invoiceNumber: string) =>
    table.getByText(invoiceNumber, { exact: true }).closest("tr")!;
  const marker = '[data-slot="invoice-document-unavailable"]';
  const badge = m.accountingInvoiceCancelledBadge({}, { locale });

  expect(rowOf(invoice.invoiceNumber).querySelector(marker)).toBeNull();

  const live = rowOf(unreadable.invoiceNumber);
  expect(live.querySelectorAll(marker)).toHaveLength(1);
  expect(live.querySelectorAll("a")).toHaveLength(0);
  expect(live.querySelectorAll("button")).toHaveLength(0);
  expect(within(live).queryByText(badge)).toBeNull();

  const cancelled = rowOf(cancelledUnreadable.invoiceNumber);
  expect(cancelled.querySelectorAll(marker)).toHaveLength(1);
  expect(cancelled.querySelectorAll("a")).toHaveLength(0);
  expect(within(cancelled).getByText(badge)).toBeTruthy();
  expect(
    within(cancelled)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
  ).toEqual([
    m.accountingInvoiceHideLabel(
      { invoiceNumber: cancelledUnreadable.invoiceNumber },
      { locale }
    ),
  ]);
});

test("reports a cancelled invoice's delivery from its cancellation notices, not its original email", () => {
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
  const locale = "en-US";
  const cancelledWith = (
    suffix: string,
    delivery: InvoiceAdministrationListItem["delivery"],
    notices: InvoiceNoticeSummary
  ): InvoiceAdministrationTableRow => ({
    ...cancelledInvoice,
    id: AdministrationInvoiceId.make(
      `018f47d2-8f7c-7c5e-9f9a-6ef21f90cb${suffix}`
    ),
    invoiceNumber: `20260000${suffix}`,
    delivery,
    needsAttention: notices.needsAttention,
    cancellation: { ...cancelledInvoice.cancellation!, notices },
  });
  // The customer's invoice email failed, so no customer notice is owed.
  const noticesSent = cancelledWith(
    "31",
    { customer: "failed", internal: "accepted" },
    { customer: "not_owed", internal: "accepted", needsAttention: false }
  );
  const noticeSending = cancelledWith(
    "32",
    { customer: "accepted", internal: "accepted" },
    { customer: "processing", internal: "accepted", needsAttention: false }
  );
  const noticeFailed = cancelledWith(
    "33",
    { customer: "accepted", internal: "accepted" },
    { customer: "failed", internal: "accepted", needsAttention: true }
  );
  const view = render(
    <RouteLocaleProvider locale={locale}>
      <InvoiceAdministrationTable
        items={[noticesSent, noticeSending, noticeFailed]}
        query={{}}
      />
    </RouteLocaleProvider>
  );
  const table = view.getByRole("table");
  const deliveryColumn = within(table)
    .getAllByRole("columnheader")
    .findIndex((header) =>
      within(header).queryByText(
        m.accountingInvoiceColumnDelivery({}, { locale })
      )
    );
  const deliveryOf = (row: InvoiceAdministrationTableRow) =>
    (
      within(table)
        .getByRole("link", { name: row.invoiceNumber })
        .closest("tr") as HTMLTableRowElement
    ).cells[deliveryColumn]!.textContent?.trim();

  expect(deliveryColumn).toBeGreaterThan(-1);
  expect(deliveryOf(noticesSent)).toBe(
    m.accountingInvoiceDeliverySent({}, { locale })
  );
  expect(deliveryOf(noticeSending)).toBe(
    m.accountingInvoiceDeliverySending({}, { locale })
  );
  expect(deliveryOf(noticeFailed)).toBe(
    m.accountingInvoiceDeliveryNeedsResend({}, { locale })
  );
});
