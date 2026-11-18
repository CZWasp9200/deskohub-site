import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { AdministrationInvoiceId } from "@deskohub/workspace-admin-api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  workspaceRouterRefresh,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { InvoiceCancellationPreview } from "./invoice-cancellation-preview";

const previewAction = mock();
const cancelAction = mock();
mock.module("./actions", () => ({
  previewAdministrationInvoiceCancellation: previewAction,
  cancelAdministrationInvoice: cancelAction,
}));

type Callbacks = {
  readonly onSuccess: (args: { readonly data?: unknown }) => void;
  readonly onError: (args: {
    readonly error: { readonly serverError?: string };
  }) => void;
};

const executePreview = mock();
const executeCancel = mock();
let previewCallbacks: Callbacks | undefined;
let cancelCallbacks: Callbacks | undefined;

let InvoiceCancellation: typeof import("./invoice-cancellation-dialog").InvoiceCancellation;

beforeAll(async () => {
  registerWorkspaceComponentTestEnv();
  ({ InvoiceCancellation } = await import("./invoice-cancellation-dialog"));
});

beforeEach(() => {
  executePreview.mockClear();
  executeCancel.mockClear();
  workspaceRouterRefresh.mockClear();
  workspaceUseAction.mockReset();
  workspaceUseAction.mockImplementation((action, options) => {
    if (action === previewAction) {
      previewCallbacks = options as Callbacks;
      return { execute: executePreview, isExecuting: false } as never;
    }
    cancelCallbacks = options as Callbacks;
    return { execute: executeCancel, isExecuting: false } as never;
  });
});

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const locale = "en-US" as const;
const invoiceId = AdministrationInvoiceId.make(
  "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21"
);
const invoiceNumber = "2026000001";
const reservationId = "01980000-0000-7000-8000-00000000abcd";

const livePreview = ({
  sent,
  reservation,
}: {
  readonly sent: boolean;
  readonly reservation: boolean;
}): InvoiceCancellationPreview => ({
  state: "live",
  invoiceNumber,
  customerNotice: sent ? "owed" : "not_owed",
  reservation: reservation
    ? {
        reservationId: reservationId as never,
        label: "Open space, 30 Sept 2026",
      }
    : null,
});

const sentWarning = m.accountingInvoiceCancelSentWarning(
  { invoiceNumber },
  { locale }
);
const reservationWarning = m.accountingInvoiceCancelReservationWarning(
  { reservation: "Open space, 30 Sept 2026" },
  { locale }
);
const reservationEffects = m.administrationReservationCancellationDescription(
  {},
  { locale }
);
const emailCheckbox = m.administrationReservationCancellationSendEmail(
  {},
  { locale }
);
const submitLabel = m.accountingInvoiceCancelSubmit({}, { locale });

const renderCancellation = (onCancelled = mock()) => {
  const view = render(
    <RouteLocaleProvider locale={locale}>
      <InvoiceCancellation
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
        onCancelled={onCancelled}
        placement="row"
      />
    </RouteLocaleProvider>
  );
  return { view, onCancelled };
};

/** Opens the dialog and answers its plan read with `preview`. */
const openWith = async (
  view: ReturnType<typeof render>,
  preview: InvoiceCancellationPreview
) => {
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.accountingInvoiceCancelLabel({ invoiceNumber }, { locale }),
      })
    );
  });
  expect(executePreview).toHaveBeenCalledWith({ invoiceId });
  await act(async () => {
    previewCallbacks?.onSuccess({ data: preview });
  });
  return within(view.getByRole("dialog"));
};

const submit = async (dialog: ReturnType<typeof within>) => {
  await act(async () => {
    fireEvent.submit(
      dialog.getByRole("form", {
        name: m.accountingInvoiceCancelFormLabel({}, { locale }),
      })
    );
  });
};

describe("InvoiceCancellation", () => {
  test.each([
    { sent: false, reservation: false },
    { sent: true, reservation: false },
    { sent: false, reservation: true },
    { sent: true, reservation: true },
  ])(
    "shows exactly the warnings the plan calls for and submits them (sent $sent, reservation $reservation)",
    async ({ sent, reservation }) => {
      const { view } = renderCancellation();
      const dialog = await openWith(view, livePreview({ sent, reservation }));

      expect(dialog.queryByText(sentWarning) !== null).toBe(sent);
      expect(dialog.queryByText(reservationWarning) !== null).toBe(reservation);
      expect(dialog.queryByText(reservationEffects) !== null).toBe(reservation);
      expect(
        dialog.queryByRole("checkbox", { name: emailCheckbox }) !== null
      ).toBe(reservation);
      expect(dialog.queryAllByRole("checkbox")).toHaveLength(
        reservation ? 1 : 0
      );

      await submit(dialog);

      expect(executeCancel).toHaveBeenCalledTimes(1);
      expect(executeCancel.mock.calls[0]?.[0]).toEqual({
        invoiceId,
        confirmedCustomerNotice: sent,
        ...(reservation && {
          reservation: {
            sendCancellationEmail: true,
          },
        }),
      });
    }
  );

  test.each([{ sent: false }, { sent: true }])(
    "submits the operator's email choice with the reservation confirmation (sent $sent)",
    async ({ sent }) => {
      const { view } = renderCancellation();
      const dialog = await openWith(
        view,
        livePreview({ sent, reservation: true })
      );
      const submitButton = dialog.getByRole("button", { name: submitLabel });
      expect(submitButton.hasAttribute("disabled")).toBe(false);

      fireEvent.click(dialog.getByRole("checkbox", { name: emailCheckbox }));
      await submit(dialog);

      expect(executeCancel.mock.calls[0]?.[0]).toEqual({
        invoiceId,
        confirmedCustomerNotice: sent,
        reservation: {
          sendCancellationEmail: false,
        },
      });
    }
  );

  test("dismissing the dialog cancels nothing", async () => {
    const { view } = renderCancellation();
    const dialog = await openWith(
      view,
      livePreview({ sent: true, reservation: true })
    );

    await act(async () => {
      fireEvent.click(
        dialog.getByRole("button", {
          name: m.accountingInvoiceCancelKeep({}, { locale }),
        })
      );
    });

    expect(view.queryByRole("dialog")).toBeNull();
    expect(executeCancel).not.toHaveBeenCalled();
  });

  test("shows a refusal in the mounted alert, reads the warnings again and refreshes the page", async () => {
    const { view } = renderCancellation();
    const dialog = await openWith(
      view,
      livePreview({ sent: false, reservation: false })
    );
    const alert = dialog.getByRole("alert");
    expect(alert.textContent).toBe("");
    executePreview.mockClear();
    const refusal = m.accountingInvoiceCancelErrorConfirmationStale(
      {},
      { locale }
    );

    await act(async () => {
      cancelCallbacks?.onError({ error: { serverError: refusal } });
    });
    expect(dialog.getByRole("alert").textContent).toBe(refusal);
    expect(executePreview).toHaveBeenCalledWith({ invoiceId });
    expect(workspaceRouterRefresh).toHaveBeenCalled();

    // The re-read plan now owes the customer a notice: the dialog shows it.
    await act(async () => {
      previewCallbacks?.onSuccess({
        data: livePreview({ sent: true, reservation: false }),
      });
    });
    expect(dialog.queryByText(sentWarning)).not.toBeNull();
    // The same mounted region keeps the refusal while the warnings change.
    expect(dialog.getByRole("alert")).toBe(alert);
    expect(alert.textContent).toBe(refusal);
  });

  test("closes and reports the outcome once the invoice is cancelled", async () => {
    const { view, onCancelled } = renderCancellation();
    await openWith(view, livePreview({ sent: false, reservation: true }));

    await act(async () => {
      cancelCallbacks?.onSuccess({
        data: {
          outcome: "cancelled",
          correctiveDocumentNumber: "WS-OD-2026-000001",
          reservationId,
          reservationEmail: "failed",
        },
      });
    });

    expect(view.queryByRole("dialog")).toBeNull();
    expect(onCancelled).toHaveBeenCalledWith(
      m.accountingInvoiceCancelSucceededReservationEmailFailed(
        { correctiveDocumentNumber: "WS-OD-2026-000001" },
        { locale }
      )
    );
    expect(workspaceRouterRefresh).toHaveBeenCalled();
  });

  test("offers no submit for an invoice cancelled meanwhile", async () => {
    const { view } = renderCancellation();
    const dialog = await openWith(view, { state: "cancelled" });

    expect(
      dialog.queryByText(
        m.accountingInvoiceCancelAlreadyCancelled({}, { locale })
      )
    ).not.toBeNull();
    expect(dialog.queryByRole("button", { name: submitLabel })).toBeNull();
    expect(workspaceRouterRefresh).toHaveBeenCalled();
  });
});
