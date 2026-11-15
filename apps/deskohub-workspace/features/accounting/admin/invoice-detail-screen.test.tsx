import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type {
  InvoiceAdministrationCancellation,
  InvoiceAdministrationDetail,
} from "./invoice-administration.service";
import { invoiceAdministrationDetail } from "./invoice-detail.test-utils";

const locale = "en-US";
let detail = invoiceAdministrationDetail();
const loadInvoiceAdministrationDetail = mock((_invoiceId: string) =>
  Promise.resolve(detail)
);
type ChainLink = { readonly id: string; readonly invoiceNumber: string } | null;
let chain: { replaces: ChainLink; replacedBy: ChainLink } = {
  replaces: null,
  replacedBy: null,
};
const loadInvoiceAdministrationChainLinks = mock(
  (_invoice: InvoiceAdministrationDetail) => Promise.resolve(chain)
);

// The real request-locale module reads the route locale from next/root-params.
mock.module("next/root-params", () => ({ locale: async () => locale }));
const invoiceActions = await import("./actions");
mock.module("./actions", () => ({
  ...invoiceActions,
  retryAdministrationInvoice: mock(),
  previewAdministrationInvoiceCancellation: mock(),
  cancelAdministrationInvoice: mock(),
  archiveAdministrationInvoice: mock(),
}));
const invoicePageData = await import("./page-data.server");
mock.module("./page-data.server", () => ({
  ...invoicePageData,
  loadInvoiceAdministrationDetail,
  loadInvoiceAdministrationChainLinks,
}));
const requestLocale = await import("@/features/i18n/server/request-locale");
mock.module("@/features/i18n/server/request-locale", () => ({
  ...requestLocale,
  getRequestLocale: () => Promise.resolve(locale),
}));

const { cleanup, render } = await import("@testing-library/react");
const { InvoiceSettlement } = await import(
  "@/features/accounting/invoice-settlement"
);
const { m } = await import("@/features/administration/i18n");
const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
const { InvoiceAdministrationDetailScreen } = await import(
  "./invoice-detail-screen"
);

type DetailContentProps = {
  readonly locale: Locale;
  readonly params: Promise<{ readonly invoiceId: string }>;
};
type DetailContent = (props: DetailContentProps) => Promise<ReactNode>;

/** Resolves the screen's suspended content the way the server renders it. */
const renderDetail = async (invoice: InvoiceAdministrationDetail) => {
  detail = invoice;
  const screen = await InvoiceAdministrationDetailScreen({
    params: Promise.resolve({ invoiceId: invoice.id }),
  });
  const content: ReactElement<DetailContentProps, DetailContent> =
    screen.props.children;
  return render(
    <RouteLocaleProvider locale={locale}>
      {await content.type(content.props)}
    </RouteLocaleProvider>
  );
};

const definition = (
  view: Awaited<ReturnType<typeof renderDetail>>,
  term: string
) =>
  Array.from(view.container.querySelectorAll("dt")).find(
    (element) => element.textContent === term
  )?.nextElementSibling?.textContent;

describe("InvoiceAdministrationDetailScreen", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    workspaceUseAction.mockImplementation(
      () => ({ execute: mock(), isExecuting: false }) as never
    );
  });
  afterEach(() => {
    cleanup();
    loadInvoiceAdministrationDetail.mockClear();
    chain = { replaces: null, replacedBy: null };
  });
  afterAll(async () => {
    workspaceUseAction.mockReset();
    await unregisterWorkspaceComponentTestEnv();
  });

  test("loads the requested invoice and shows its PDF, delivery, and provenance", async () => {
    const invoice = invoiceAdministrationDetail({ actor: "Ada Admin" });

    const view = await renderDetail(invoice);

    expect(loadInvoiceAdministrationDetail).toHaveBeenCalledWith(invoice.id);
    expect(
      view.getByRole("heading", { level: 1, name: invoice.invoiceNumber })
    ).toBeDefined();
    const pdf = view.getByTitle(
      m.accountingInvoiceDetailPdfTitle(
        { invoiceNumber: invoice.invoiceNumber },
        { locale }
      )
    );
    expect(pdf.getAttribute("src")).toBe(
      `/en-US/admin/invoices/${invoice.id}/pdf`
    );
    expect(
      definition(view, m.accountingInvoiceDetailActor({}, { locale }))
    ).toBe("Ada Admin");
    expect(
      view.getByText(
        m.accountingInvoiceDeliveryAudienceInternal({}, { locale })
      )
    ).toBeDefined();
  });

  test("shows the due date only while payment is requested and no payment date", async () => {
    const view = await renderDetail(
      invoiceAdministrationDetail({
        settlement: InvoiceSettlement.PaymentRequested({
          dueDate: "2026-09-01" as never,
          variableSymbol: "2026000042" as never,
        }),
      })
    );

    expect(
      definition(view, m.accountingInvoiceDetailDueDate({}, { locale }))
    ).toBeDefined();
    expect(
      definition(view, m.accountingInvoiceDetailPaidOn({}, { locale }))
    ).toBeUndefined();
  });

  test("shows the payment date of a paid invoice and the legacy actor without one", async () => {
    const view = await renderDetail(
      invoiceAdministrationDetail({
        paidOn: "2026-08-20",
        paymentStatus: "paid",
        settlement: InvoiceSettlement.Paid({
          paidOn: "2026-08-20" as never,
          variableSymbol: null,
        }),
      })
    );

    expect(
      definition(view, m.accountingInvoiceDetailPaidOn({}, { locale }))
    ).toBeDefined();
    expect(
      definition(view, m.accountingInvoiceDetailDueDate({}, { locale }))
    ).toBeUndefined();
    expect(
      definition(view, m.accountingInvoiceDetailActor({}, { locale }))
    ).toBe(m.accountingInvoiceSourceLegacy({}, { locale }));
  });
  const cancellation = (
    notices: InvoiceAdministrationCancellation["notices"]
  ): InvoiceAdministrationCancellation => ({
    cancelledAt: "2026-08-20T10:00:00.000Z",
    cause: "reservation_cancellation",
    source: "dhw-cli",
    actor: testEmailAddress("invoice-detail-operator"),
    correctiveDocumentNumber: "WS-OD-2026-000001",
    correctiveDocumentIssuedAt: "2026-08-20T10:00:00.000Z",
    correctiveDocumentPdfUrl:
      "/admin/invoices/01980000-0000-7000-8000-000000000042/corrective-document" as never,
    notices,
  });
  const cancelledDetail = (
    notices: InvoiceAdministrationCancellation["notices"]
  ) =>
    invoiceAdministrationDetail({
      cancellation: cancellation(notices),
      cancellationPlan: null,
      needsAttention: notices.needsAttention,
    });
  const button = (
    view: Awaited<ReturnType<typeof renderDetail>>,
    name: string
  ) => view.queryByRole("button", { name });

  test("offers cancelling a live invoice and shows no cancellation panel", async () => {
    const view = await renderDetail(
      invoiceAdministrationDetail({ needsAttention: true })
    );

    expect(
      button(view, m.accountingInvoiceCancelOpen({}, { locale }))
    ).not.toBeNull();
    expect(
      button(view, m.accountingInvoiceRetryDelivery({}, { locale }))
    ).not.toBeNull();
    expect(
      view.queryByRole("heading", {
        name: m.accountingInvoiceCancellationSection({}, { locale }),
      })
    ).toBeNull();
    expect(
      view.queryByText(m.accountingInvoiceCancelledBadge({}, { locale }))
    ).toBeNull();
  });

  test("shows a cancelled invoice's cancellation with its credit note and hide action, without cancel or the original retry", async () => {
    const invoice = cancelledDetail({
      customer: "accepted",
      internal: "accepted",
      needsAttention: false,
    });

    const view = await renderDetail(invoice);

    expect(
      view.getByText(m.accountingInvoiceCancelledBadge({}, { locale }))
    ).toBeDefined();
    expect(
      definition(view, m.accountingInvoiceCancellationActor({}, { locale }))
    ).toBe(invoice.cancellation?.actor);
    expect(
      definition(view, m.accountingInvoiceCancellationChannel({}, { locale }))
    ).toBe(m.accountingInvoiceSourceDhwCli({}, { locale }));
    expect(
      definition(view, m.accountingInvoiceCancellationCause({}, { locale }))
    ).toBe(m.accountingInvoiceCancellationCauseReservation({}, { locale }));
    const creditNote = view.getByRole("link", { name: "WS-OD-2026-000001" });
    expect(creditNote.getAttribute("href")).toBe(
      `/en-US/admin/invoices/${invoice.id}/corrective-document`
    );
    expect(
      button(view, m.accountingInvoiceHideOpen({}, { locale }))
    ).not.toBeNull();
    expect(
      button(view, m.accountingInvoiceCancelOpen({}, { locale }))
    ).toBeNull();
    expect(
      button(view, m.accountingInvoiceRetryDelivery({}, { locale }))
    ).toBeNull();
    expect(
      button(view, m.accountingInvoiceCancellationNoticesRetry({}, { locale }))
    ).toBeNull();
  });

  test("offers resending the cancellation notices while one needs attention", async () => {
    const view = await renderDetail(
      cancelledDetail({
        customer: "failed",
        internal: "accepted",
        needsAttention: true,
      })
    );

    expect(
      button(view, m.accountingInvoiceCancellationNoticesRetry({}, { locale }))
    ).not.toBeNull();
    expect(
      view.getAllByText(m.accountingInvoiceDeliveryStatusFailed({}, { locale }))
        .length
    ).toBeGreaterThan(0);
    expect(
      button(view, m.accountingInvoiceRetryDelivery({}, { locale }))
    ).toBeNull();
  });

  test("links the replaced and replacing invoices the Admin UI still shows", async () => {
    chain = {
      replaces: {
        id: "01980000-0000-7000-8000-000000000041",
        invoiceNumber: "DH-2026-0041",
      },
      replacedBy: null,
    };

    const view = await renderDetail(
      invoiceAdministrationDetail({
        replacesInvoiceId: "01980000-0000-7000-8000-000000000041" as never,
        replacedByInvoiceId: "01980000-0000-7000-8000-000000000043" as never,
      })
    );

    expect(
      view.getByRole("link", { name: "DH-2026-0041" }).getAttribute("href")
    ).toBe("/en-US/admin/invoices/01980000-0000-7000-8000-000000000041");
    expect(
      definition(view, m.accountingInvoiceDetailReplacedBy({}, { locale }))
    ).toBeUndefined();
  });
});
