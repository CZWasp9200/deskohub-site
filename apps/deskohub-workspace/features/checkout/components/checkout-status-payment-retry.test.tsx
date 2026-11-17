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
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@/features/checkout/actions/prepare-payment-retry", () => ({
  preparePaymentRetry: mock(),
}));
const leaveDocument = mock((_url: string) => true);
mock.module("@/shared/browser/document-navigation", () => ({
  leaveDocument,
}));

const { CheckoutStatusPaymentRetry } = await import(
  "./checkout-status-payment-retry"
);

type ActionOptions = {
  readonly onSuccess: (result: { readonly data?: unknown }) => void;
  readonly onError: (result: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

const orderId = "reservation-retry" as WorkspaceReservationId;

const renderRetry = ({ isExecuting = false } = {}) => {
  const execute = mock(
    (_input: { readonly locale: string; readonly orderId: string }) => undefined
  );
  workspaceUseAction.mockReturnValue({ execute, isExecuting } as never);
  const view = render(
    <CheckoutStatusPaymentRetry
      className="actions"
      fallback={
        <a href="/en-US/reservation/cowork" id="checkout-status-reserve-again">
          again
        </a>
      }
      locale="en-US"
      orderId={orderId}
    >
      <a href="/en-US">home</a>
    </CheckoutStatusPaymentRetry>
  );
  const options = () => {
    const latest = workspaceUseAction.mock.calls.at(-1)?.[1] as
      | ActionOptions
      | undefined;
    if (!latest) throw new Error("Retry action options missing");
    return latest;
  };
  const button = () =>
    view.container.querySelector("#checkout-status-try-payment-again");
  const fallback = () =>
    view.container.querySelector("#checkout-status-reserve-again");
  return { button, execute, fallback, options, view };
};

describe("CheckoutStatusPaymentRetry", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceRouterPush.mockClear();
    workspaceRouterRefresh.mockClear();
    workspaceUseAction.mockClear();
    leaveDocument.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("leads the action row with its button, keeping the fallback back", () => {
    const { button, fallback, view } = renderRetry();

    const row = view.container.querySelector(".actions");
    expect(row?.firstElementChild).toBe(button());
    expect(fallback()).toBeNull();
    expect(view.getByRole("alert").textContent).toBe("");
  });

  test("asks to retry the order with only the order and locale", () => {
    const { button, execute } = renderRetry();

    fireEvent.click(button() as HTMLButtonElement);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ locale: "en-US", orderId });
  });

  test("is disabled while the request runs", () => {
    const { button, execute } = renderRetry({ isExecuting: true });

    expect((button() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button() as HTMLButtonElement);
    expect(execute).not.toHaveBeenCalled();
  });

  test("opens the retry's Pay page as a new document", () => {
    const { options } = renderRetry();

    act(() => {
      options().onSuccess({
        data: { state: "ready", payUrl: "/en-US/checkout/pay?orderId=x" },
      });
    });

    expect(leaveDocument).toHaveBeenCalledWith("/en-US/checkout/pay?orderId=x");
    expect(workspaceRouterPush).not.toHaveBeenCalled();
  });

  test.each(["refused", "spot_unavailable"] as const)(
    "puts the new reservation in the button's place when the retry is %s",
    (state) => {
      const { button, fallback, options, view } = renderRetry();

      act(() => {
        options().onSuccess({ data: { state } });
      });

      expect(button()).toBeNull();
      expect(fallback()).not.toBeNull();
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
      expect(
        view.container.querySelector("#checkout-status-payment-retry-refusal")
      ).toEqual(state === "spot_unavailable" ? expect.anything() : null);
    }
  );

  test("only refreshes the status while the earlier payment may settle", () => {
    const { button, fallback, options } = renderRetry();

    act(() => {
      options().onSuccess({ data: { state: "payment_settling" } });
    });

    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    expect(button()).not.toBeNull();
    expect(fallback()).toBeNull();
  });

  test("shows a failure in its alert region", () => {
    const { options, view } = renderRetry();

    act(() => {
      options().onTransportError();
    });

    expect(view.getByRole("alert").textContent).not.toBe("");
  });
});
