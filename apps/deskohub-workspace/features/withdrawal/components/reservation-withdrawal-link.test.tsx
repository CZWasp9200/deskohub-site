import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { useAction } from "next-safe-action/hooks";
import { m } from "@/features/i18n";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { formatMoney } from "@/shared/money/money";
import {
  workspaceRouterRefresh,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type ActionResult = {
  data?: unknown;
  serverError?: string;
};

const paid = { value: 300_000, exponent: 2, currency: "CZK" };
const quote = (customerName: string | null) => ({
  contractId: "reservation-1",
  contractLabel: "Office · 10.–12. 1. 2027",
  customerName,
  receiptEmail: testEmailAddress("customer"),
  paidAmount: paid,
  refundAmount: { ...paid, value: 200_000 },
  refundBasis: { kind: "partial", unit: "day", unstarted: 2, total: 3 },
  refundTermsKey: "two-days",
  periodEndsAt: "2027-01-16T23:00:00Z",
});
const receipt = {
  withdrawalId: "withdrawal-1",
  submittedAt: "2027-01-10T08:00:00Z",
  refundAmount: { ...paid, value: 200_000 },
  receiptEmail: testEmailAddress("customer"),
};

const quoteReservationWithdrawal = mock(
  (_input: { readonly orderId: string }): Promise<ActionResult> =>
    Promise.resolve({
      data: { status: "available", quote: quote("Alex Example") },
    })
);
const withdrawFromReservation = mock(
  (_input: { readonly orderId: string }): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "withdrawn", receipt } })
);
mock.module("@/features/account/withdrawal-actions", () => ({
  quoteReservationWithdrawal,
  withdrawFromReservation,
}));

registerWorkspaceComponentTestEnv();
// The library hook behind useWorkspaceAction drives the dialog's states.
workspaceUseAction.mockImplementation(useAction as never);
// @testing-library/react and the dialog load after the happy-dom registration.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { ReservationWithdrawalLink } = await import(
  "./reservation-withdrawal-link"
);

const locale = "en-US";
const orderId = workspaceReservationIdSchema.make("reservation-1");

const openDialog = async () => {
  const view = render(
    <ReservationWithdrawalLink
      locale={locale}
      orderId={orderId}
      reference="reservation-1"
    />
  );
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationWithdrawalAction({}, { locale }),
      })
    );
  });
  return view;
};

const confirmButton = (view: ReturnType<typeof render>) =>
  view.findByRole("button", {
    name: m.withdrawalConfirmSubmit({}, { locale }),
  });

describe("ReservationWithdrawalLink", () => {
  beforeEach(() => {
    quoteReservationWithdrawal.mockClear();
    withdrawFromReservation.mockClear();
    workspaceRouterRefresh.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    workspaceUseAction.mockImplementation(() => undefined);
    await unregisterWorkspaceComponentTestEnv();
  });

  test("quotes on open, withdraws on confirm, then refreshes the page once closed", async () => {
    const view = await openDialog();

    expect(quoteReservationWithdrawal).toHaveBeenCalledWith({ orderId });
    expect(await view.findByText("Alex Example")).toBeTruthy();
    expect(
      view.queryByLabelText(m.withdrawalConfirmNameLabel({}, { locale }))
    ).toBeNull();

    await act(async () => {
      fireEvent.click(await confirmButton(view));
    });

    expect(withdrawFromReservation).toHaveBeenCalledWith({
      orderId,
      refundTermsKey: "two-days",
    });
    expect(
      await view.findByRole("heading", {
        name: m.withdrawalReceivedTitle({}, { locale }),
      })
    ).toBeTruthy();
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        view.getAllByRole("button", {
          name: m.withdrawalClose({}, { locale }),
        })[0] as HTMLElement
      );
    });

    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
  });

  test("asks for the name when the account has none, and sends the typed one", async () => {
    quoteReservationWithdrawal.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "available", quote: quote(null) } })
    );
    const view = await openDialog();

    await act(async () => {
      fireEvent.click(await confirmButton(view));
    });
    expect(withdrawFromReservation).not.toHaveBeenCalled();
    expect(
      await view.findByText(m.withdrawalConfirmNameRequired({}, { locale }))
    ).toBeTruthy();

    await act(async () => {
      fireEvent.change(
        view.getByLabelText(m.withdrawalConfirmNameLabel({}, { locale })),
        { target: { value: "  Sam Typed " } }
      );
    });
    await act(async () => {
      fireEvent.click(await confirmButton(view));
    });

    expect(withdrawFromReservation).toHaveBeenCalledWith({
      orderId,
      customerName: "Sam Typed",
      refundTermsKey: "two-days",
    });
  });

  test("shows the updated refund and keeps the name until the customer confirms again", async () => {
    quoteReservationWithdrawal.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "available", quote: quote(null) } })
    );
    withdrawFromReservation
      .mockImplementationOnce(() =>
        Promise.resolve({
          data: {
            status: "refund_changed",
            quote: {
              ...quote(null),
              refundBasis: {
                kind: "partial",
                unit: "day",
                unstarted: 1,
                total: 3,
              },
              refundAmount: { ...paid, value: 100_000 },
              refundTermsKey: "one-day",
            },
          },
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({ serverError: "Temporary failure" })
      );
    const view = await openDialog();
    const name = await view.findByLabelText<HTMLInputElement>(
      m.withdrawalConfirmNameLabel({}, { locale })
    );
    await act(async () => {
      fireEvent.change(name, { target: { value: "Sam Typed" } });
      fireEvent.click(await confirmButton(view));
    });

    expect((await view.findByRole("status")).textContent).toContain(
      m.withdrawalRefundChanged({}, { locale })
    );
    expect(view.getByRole("dialog").textContent).toContain(
      formatMoney({ ...paid, value: 100_000 }, locale)
    );
    expect(name.value).toBe("Sam Typed");
    expect(withdrawFromReservation).toHaveBeenCalledTimes(1);
    expect(withdrawFromReservation).toHaveBeenLastCalledWith({
      orderId,
      customerName: "Sam Typed",
      refundTermsKey: "two-days",
    });
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(await confirmButton(view));
    });
    expect(await view.findByText("Temporary failure")).toBeTruthy();
    await act(async () => {
      fireEvent.click(await confirmButton(view));
    });
    expect(withdrawFromReservation.mock.calls.slice(1)).toEqual([
      [{ orderId, customerName: "Sam Typed", refundTermsKey: "one-day" }],
      [{ orderId, customerName: "Sam Typed", refundTermsKey: "one-day" }],
    ]);
    expect(
      await view.findByRole("heading", {
        name: m.withdrawalReceivedTitle({}, { locale }),
      })
    ).toBeTruthy();
  });

  test("asks for the name when the server needs one the profile couldn't give", async () => {
    withdrawFromReservation.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "name_required" } })
    );
    const view = await openDialog();

    await act(async () => {
      fireEvent.click(await confirmButton(view));
    });

    expect(
      await view.findByLabelText(m.withdrawalConfirmNameLabel({}, { locale }))
    ).toBeTruthy();
  });

  test("explains a refusal instead of the statement", async () => {
    quoteReservationWithdrawal.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: "refused", reason: "period_ended" } })
    );
    const view = await openDialog();

    expect(
      await view.findByText(m.withdrawalRefusedPeriodEnded({}, { locale }))
    ).toBeTruthy();
    expect(
      view.queryByRole("button", {
        name: m.withdrawalConfirmSubmit({}, { locale }),
      })
    ).toBeNull();
  });

  test("offers a retry when the quote can't be read", async () => {
    quoteReservationWithdrawal.mockImplementationOnce(() =>
      Promise.reject(new Error("network down"))
    );
    const view = await openDialog();

    await act(async () => {
      fireEvent.click(
        await view.findByRole("button", {
          name: m.withdrawalRetry({}, { locale }),
        })
      );
    });

    expect(quoteReservationWithdrawal).toHaveBeenCalledTimes(2);
    expect(await confirmButton(view)).toBeTruthy();
  });

  test("keeps the statement with an error when the withdrawal can't be sent", async () => {
    withdrawFromReservation.mockImplementationOnce(() =>
      Promise.resolve({ serverError: "Withdrawal unavailable right now." })
    );
    const view = await openDialog();

    await act(async () => {
      fireEvent.click(await confirmButton(view));
    });

    expect(
      await view.findByText("Withdrawal unavailable right now.")
    ).toBeTruthy();
    expect(await confirmButton(view)).toBeTruthy();
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });
});
