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
import { AdministrationWorkspaceReservationId } from "@deskohub/workspace-admin-api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { Schema } from "effect";
import type {
  FlattenedValidationErrors,
  ValidationErrors,
} from "next-safe-action";
import type { SingleInputActionFn } from "next-safe-action/hooks";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { formatMoney } from "@/shared/money/money";
import {
  workspaceRouterRefresh,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { m } from "./i18n";
import type {
  ReservationRestorationAction,
  ReservationRestorationPreview,
  ReservationRestorationRequest,
  ReservationRestorationResult,
} from "./reservation-restoration";

const execute = mock();
const restoreReservation: ReservationRestorationAction = mock();

type ActionOptions = {
  readonly onSuccess: (args: {
    readonly data?: ReservationRestorationResult;
  }) => void;
  readonly onError: (args: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

// The restore Server Action has the shape every administration action has, so
// the reservation detail can pass it straight to the component.
const administrationRestorationSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    reservationId: AdministrationWorkspaceReservationId,
    acknowledgeRefundedPayment: Schema.Boolean,
    sendRestorationEmail: Schema.Boolean,
  })
);
type AdministrationRestorationAction = SingleInputActionFn<
  string,
  typeof administrationRestorationSchema,
  FlattenedValidationErrors<
    ValidationErrors<typeof administrationRestorationSchema>
  >,
  ReservationRestorationResult
>;

type AcceptsAdministrationAction =
  AdministrationRestorationAction extends ReservationRestorationAction
    ? true
    : never;

let actionOptions: ActionOptions | undefined;
let usedAction: unknown;

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  execute.mockClear();
  workspaceRouterRefresh.mockClear();
  actionOptions = undefined;
  usedAction = undefined;
  workspaceUseAction.mockReset();
  workspaceUseAction.mockImplementation((action, options) => {
    usedAction = action;
    actionOptions = options as ActionOptions | undefined;
    return { execute, isExecuting: false, result: {} };
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await unregisterWorkspaceComponentTestEnv();
});

const fixtureReservationId = "01980000-0000-7000-8000-00000000abcd";
const refundedAmount = { value: 25_000, exponent: 2, currency: "CZK" };

/** Testing Library collapses the formatted amount's no-break space in the page text. */
const refundedAmountText = (locale: "cs-CZ" | "en-US") =>
  formatMoney(refundedAmount, locale).replace(/\s+/g, " ");

const restorableReservation = {
  cancellationEmailRecorded: true,
  issuesNewAccess: false,
  issuesNewInvoice: false,
  clearsRefundRequirement: false,
  refundedPayment: null,
} satisfies ReservationRestorationPreview;

type Locale = "cs-CZ" | "en-US";

const renderRestoration = async (
  restoration: ReservationRestorationPreview | null = restorableReservation,
  locale: Locale = "en-US"
) => {
  const { ReservationRestoration } = await import("./reservation-restoration");
  return render(
    <RouteLocaleProvider locale={locale}>
      <ReservationRestoration
        reservationId={fixtureReservationId}
        restoration={restoration}
        restoreReservation={restoreReservation}
      />
    </RouteLocaleProvider>
  );
};

const openDialog = async (
  view: ReturnType<typeof render>,
  locale: Locale = "en-US"
) => {
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.administrationReservationRestorationOpen({}, { locale }),
      })
    );
  });
  return within(view.getByRole("dialog"));
};

const submitDialog = async (
  dialog: ReturnType<typeof within>,
  locale: Locale = "en-US"
) => {
  await act(async () => {
    fireEvent.submit(
      dialog.getByRole("form", {
        name: m.administrationReservationRestorationFormLabel({}, { locale }),
      })
    );
  });
};

/**
 * The outcome notices, read from the one status region that announces them.
 * The open modal dialog hides it from the accessibility tree.
 */
const statusMessages = (view: ReturnType<typeof render>) =>
  Array.from(view.getByRole("status", { hidden: true }).children).map(
    (notice) => notice.textContent
  );

const submittedRequest = () =>
  execute.mock.calls[0]?.[0] as ReservationRestorationRequest | undefined;

const emailCheckbox = (dialog: ReturnType<typeof within>) =>
  dialog.queryByRole("checkbox", {
    name: m.administrationReservationRestorationSendEmail(
      {},
      { locale: "en-US" }
    ),
  });

const acknowledgementCheckbox = (dialog: ReturnType<typeof within>) =>
  dialog.queryByRole("checkbox", {
    name: m.administrationReservationRestorationRefundAcknowledgement(
      {},
      { locale: "en-US" }
    ),
  });

const submitButton = (dialog: ReturnType<typeof within>) =>
  dialog.getByRole("button", {
    name: m.administrationReservationRestorationSubmit({}, { locale: "en-US" }),
  });

describe("ReservationRestoration", () => {
  test("accepts the restore Server Action as the reservation detail passes it", () => {
    const accepted: AcceptsAdministrationAction = true;

    expect(accepted).toBe(true);
  });

  test("renders nothing for a reservation that can't be restored", async () => {
    const view = await renderRestoration(null);

    expect(view.container.childElementCount).toBe(0);
  });

  test("runs the action it is given and submits the restoration request", async () => {
    const view = await renderRestoration();
    const dialog = await openDialog(view);

    expect(emailCheckbox(dialog)?.getAttribute("aria-checked")).toBe("true");
    expect(acknowledgementCheckbox(dialog)).toBeNull();
    await submitDialog(dialog);

    expect(usedAction).toBe(restoreReservation);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(submittedRequest()).toEqual({
      reservationId: fixtureReservationId,
      acknowledgeRefundedPayment: false,
      sendRestorationEmail: true,
    });
  });

  test("submits the unchecked email choice when the operator opts out", async () => {
    const view = await renderRestoration();
    const dialog = await openDialog(view);

    const checkbox = emailCheckbox(dialog);
    if (!checkbox) throw new Error("The email checkbox is missing.");
    fireEvent.click(checkbox);
    await submitDialog(dialog);

    expect(submittedRequest()?.sendRestorationEmail).toBe(false);
  });

  test("offers no email without a recorded cancellation email", async () => {
    const view = await renderRestoration({
      ...restorableReservation,
      cancellationEmailRecorded: false,
    });
    const dialog = await openDialog(view);

    expect(emailCheckbox(dialog)).toBeNull();
    await submitDialog(dialog);

    expect(submittedRequest()?.sendRestorationEmail).toBe(false);
  });

  test("blocks a restoration over a refund until the operator acknowledges it", async () => {
    const view = await renderRestoration({
      ...restorableReservation,
      refundedPayment: { amount: refundedAmount, coverage: "full" },
    });
    const dialog = await openDialog(view);
    const warning = m.administrationReservationRestorationRefundedFull(
      { amount: refundedAmountText("en-US") },
      { locale: "en-US" }
    );

    expect(dialog.getByText(warning)).toBeDefined();
    const checkbox = acknowledgementCheckbox(dialog);
    if (!checkbox) throw new Error("The acknowledgement checkbox is missing.");
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(submitButton(dialog).hasAttribute("disabled")).toBe(true);

    await submitDialog(dialog);
    expect(execute).not.toHaveBeenCalled();
    expect(
      await dialog.findByText(
        m.administrationReservationRestorationRefundAcknowledgementRequired(
          {},
          { locale: "en-US" }
        )
      )
    ).toBeDefined();

    fireEvent.click(checkbox);
    expect(submitButton(dialog).hasAttribute("disabled")).toBe(false);
    await submitDialog(dialog);

    expect(submittedRequest()).toEqual({
      reservationId: fixtureReservationId,
      acknowledgeRefundedPayment: true,
      sendRestorationEmail: true,
    });
  });

  test("names a partial refund as partial", async () => {
    const view = await renderRestoration({
      ...restorableReservation,
      refundedPayment: { amount: refundedAmount, coverage: "partial" },
    });
    const dialog = await openDialog(view);
    const amount = refundedAmountText("en-US");

    expect(
      dialog.getByText(
        m.administrationReservationRestorationRefundedPartial(
          { amount },
          { locale: "en-US" }
        )
      )
    ).toBeDefined();
    expect(
      dialog.queryByText(
        m.administrationReservationRestorationRefundedFull(
          { amount },
          { locale: "en-US" }
        )
      )
    ).toBeNull();
  });

  test("shows the cleared refund requirement and new access notes only when they apply", async () => {
    const notes = [
      m.administrationReservationRestorationRefundRequirementCleared(
        {},
        { locale: "en-US" }
      ),
      m.administrationReservationRestorationNewAccess({}, { locale: "en-US" }),
    ];

    const plain = await openDialog(await renderRestoration());
    for (const note of notes) expect(plain.queryByText(note)).toBeNull();
    cleanup();

    const flagged = await openDialog(
      await renderRestoration({
        ...restorableReservation,
        clearsRefundRequirement: true,
        issuesNewAccess: true,
      })
    );
    for (const note of notes) expect(flagged.getByText(note)).toBeDefined();
  });

  test("names the new invoice only when the reservation's invoice was cancelled with it", async () => {
    const note = m.administrationReservationRestorationNewInvoice(
      {},
      { locale: "en-US" }
    );

    const plain = await openDialog(await renderRestoration());
    expect(plain.queryByText(note)).toBeNull();
    cleanup();

    const reissuing = await openDialog(
      await renderRestoration({
        ...restorableReservation,
        issuesNewInvoice: true,
      })
    );
    expect(reissuing.getByText(note)).toBeDefined();
  });

  test.each([
    [
      { outcome: "issued", invoiceId: "invoice-2", invoiceNumber: "WS-2" },
      m.administrationReservationRestorationInvoiceIssued(
        { invoiceNumber: "WS-2" },
        { locale: "en-US" }
      ),
    ],
    [
      { outcome: "failed", invoiceId: "invoice-2", invoiceNumber: "WS-2" },
      m.administrationReservationRestorationInvoiceSendFailed(
        { invoiceNumber: "WS-2" },
        { locale: "en-US" }
      ),
    ],
    [
      { outcome: "failed", invoiceId: null, invoiceNumber: null },
      m.administrationReservationRestorationInvoiceFailed(
        {},
        { locale: "en-US" }
      ),
    ],
    [
      { outcome: "not_issued", invoiceId: null, invoiceNumber: null },
      m.administrationReservationRestorationInvoiceNotIssued(
        {},
        { locale: "en-US" }
      ),
    ],
  ] as const)(
    "reports the new invoice's %o outcome after the restore",
    async (invoice, expected) => {
      const view = await renderRestoration();
      await submitDialog(await openDialog(view));

      act(() => {
        actionOptions?.onSuccess({
          data: {
            outcome: "restored",
            email: "not_requested",
            access: "not_needed",
            invoice,
          },
        });
      });

      expect(statusMessages(view)).toEqual([
        m.administrationReservationRestorationEmailNotRequested(
          {},
          { locale: "en-US" }
        ),
        expected,
      ]);
    }
  );

  test.each([
    ["sent", m.administrationReservationRestorationEmailSent],
    ["not_requested", m.administrationReservationRestorationEmailNotRequested],
    ["failed", m.administrationReservationRestorationEmailFailed],
    ["not_available", m.administrationReservationRestorationEmailNotAvailable],
  ] as const)(
    "reports the %s email outcome, closes the dialog and refreshes",
    async (email, message) => {
      const view = await renderRestoration();
      await submitDialog(await openDialog(view));

      act(() => {
        actionOptions?.onSuccess({
          data: {
            outcome: "restored",
            email,
            access: "not_needed",
            invoice: null,
          },
        });
      });

      expect(statusMessages(view)).toEqual([message({}, { locale: "en-US" })]);
      expect(view.queryByRole("dialog")).toBeNull();
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    }
  );

  test("keeps the outcome after the refreshed reservation is no longer restorable", async () => {
    const view = await renderRestoration();
    await submitDialog(await openDialog(view));
    act(() => {
      actionOptions?.onSuccess({
        data: {
          outcome: "already_confirmed",
          email: "not_requested",
          access: "issued",
          invoice: null,
        },
      });
    });

    const { ReservationRestoration } = await import(
      "./reservation-restoration"
    );
    view.rerender(
      <RouteLocaleProvider locale="en-US">
        <ReservationRestoration
          reservationId={fixtureReservationId}
          restoration={null}
          restoreReservation={restoreReservation}
        />
      </RouteLocaleProvider>
    );

    expect(statusMessages(view)).toEqual([
      m.administrationReservationRestorationAlreadyRestored(
        {},
        { locale: "en-US" }
      ),
      m.administrationReservationRestorationAccessIssued(
        {},
        { locale: "en-US" }
      ),
    ]);
    expect(
      view.queryByRole("button", {
        name: m.administrationReservationRestorationOpen(
          {},
          { locale: "en-US" }
        ),
      })
    ).toBeNull();
  });

  test("starts the next restoration with the refund unacknowledged", async () => {
    const refunded = {
      ...restorableReservation,
      refundedPayment: { amount: refundedAmount, coverage: "partial" },
    } satisfies ReservationRestorationPreview;
    const view = await renderRestoration(refunded);
    const dialog = await openDialog(view);
    const checkbox = acknowledgementCheckbox(dialog);
    if (!checkbox) throw new Error("The acknowledgement checkbox is missing.");
    fireEvent.click(checkbox);
    await submitDialog(dialog);
    act(() => {
      actionOptions?.onSuccess({
        data: {
          outcome: "restored",
          email: "sent",
          access: "not_needed",
          invoice: null,
        },
      });
    });

    const reopened = await openDialog(view);

    expect(
      acknowledgementCheckbox(reopened)?.getAttribute("aria-checked")
    ).toBe("false");
    expect(submitButton(reopened).hasAttribute("disabled")).toBe(true);
  });

  test("warns when the new access code could not be issued", async () => {
    const view = await renderRestoration({
      ...restorableReservation,
      issuesNewAccess: true,
    });
    await submitDialog(await openDialog(view));

    act(() => {
      actionOptions?.onSuccess({
        data: {
          outcome: "restored",
          email: "sent",
          access: "failed",
          invoice: null,
        },
      });
    });

    const [, accessNotice] = statusMessages(view);
    expect(accessNotice).toBe(
      m.administrationReservationRestorationAccessFailed(
        {},
        { locale: "en-US" }
      )
    );
  });

  test("keeps the dialog open and explains a refused or interrupted restoration", async () => {
    const view = await renderRestoration();
    const dialog = await openDialog(view);
    await submitDialog(dialog);

    act(() => {
      actionOptions?.onError({
        error: { serverError: "Synthetic refusal from the server." },
      });
    });
    expect(dialog.getByRole("alert").textContent).toBe(
      "Synthetic refusal from the server."
    );

    act(() => {
      actionOptions?.onError({ error: {} });
    });
    expect(dialog.getByRole("alert").textContent).toBe(
      m.administrationReservationRestorationFailed({}, { locale: "en-US" })
    );

    // Each server refusal reloads the preview; an interrupted request doesn't.
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(2);

    act(() => {
      actionOptions?.onTransportError();
    });
    expect(dialog.getByRole("alert").textContent).toBe(
      m.administrationReservationRestorationInterrupted({}, { locale: "en-US" })
    );

    act(() => {
      actionOptions?.onSuccess({});
    });
    expect(view.getByRole("dialog")).toBeDefined();
    expect(statusMessages(view)).toEqual([]);
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(2);
  });

  const rerenderRestoration = async (
    view: ReturnType<typeof render>,
    restoration: ReservationRestorationPreview | null
  ) => {
    const { ReservationRestoration } = await import(
      "./reservation-restoration"
    );
    view.rerender(
      <RouteLocaleProvider locale="en-US">
        <ReservationRestoration
          reservationId={fixtureReservationId}
          restoration={restoration}
          restoreReservation={restoreReservation}
        />
      </RouteLocaleProvider>
    );
  };

  test("asks for the acknowledgement once a refused restore reveals a refund", async () => {
    const view = await renderRestoration();
    const dialog = await openDialog(view);
    expect(acknowledgementCheckbox(dialog)).toBeNull();
    await submitDialog(dialog);
    act(() => {
      actionOptions?.onError({
        error: { serverError: "Synthetic refund refusal from the server." },
      });
    });
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

    await rerenderRestoration(view, {
      ...restorableReservation,
      refundedPayment: { amount: refundedAmount, coverage: "full" },
    });
    const refreshed = within(view.getByRole("dialog"));
    const checkbox = acknowledgementCheckbox(refreshed);
    if (!checkbox) throw new Error("The acknowledgement checkbox is missing.");
    fireEvent.click(checkbox);
    await submitDialog(refreshed);

    expect(execute.mock.calls.at(-1)?.[0]).toEqual({
      reservationId: fixtureReservationId,
      acknowledgeRefundedPayment: true,
      sendRestorationEmail: true,
    });
  });

  test("keeps a refusal in view when the refreshed reservation can no longer be restored", async () => {
    const view = await renderRestoration();
    await submitDialog(await openDialog(view));
    act(() => {
      actionOptions?.onError({
        error: { serverError: "Synthetic refusal from the server." },
      });
    });

    await rerenderRestoration(view, null);

    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByRole("alert").textContent).toBe(
      "Synthetic refusal from the server."
    );
  });

  test("uses the route locale for the dialog, validation and outcome", async () => {
    const locale = "cs-CZ";
    const view = await renderRestoration(
      {
        ...restorableReservation,
        refundedPayment: { amount: refundedAmount, coverage: "full" },
      },
      locale
    );
    const dialog = await openDialog(view, locale);

    expect(
      dialog.getByText(
        m.administrationReservationRestorationTitle({}, { locale })
      )
    ).toBeDefined();
    expect(
      dialog.getByText(
        m.administrationReservationRestorationRefundedFull(
          { amount: refundedAmountText(locale) },
          { locale }
        )
      )
    ).toBeDefined();
    await submitDialog(dialog, locale);
    expect(
      await dialog.findByText(
        m.administrationReservationRestorationRefundAcknowledgementRequired(
          {},
          { locale }
        )
      )
    ).toBeDefined();

    act(() => {
      actionOptions?.onSuccess({
        data: {
          outcome: "restored",
          email: "sent",
          access: "not_needed",
          invoice: null,
        },
      });
    });
    expect(
      view.getByText(
        m.administrationReservationRestorationEmailSent({}, { locale })
      )
    ).toBeDefined();
  });
});
