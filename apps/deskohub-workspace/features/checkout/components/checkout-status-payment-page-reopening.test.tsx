import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { m } from "@/features/i18n";
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

mock.module("@/features/checkout/actions/reopen-payment-page", () => ({
  reopenPaymentPage: mock(),
}));

const { CheckoutStatusPaymentPageReopening } = await import(
  "./checkout-status-payment-page-reopening"
);
const { CheckoutPaymentWindowCoordinator } = await import(
  "./checkout-payment-window"
);

type ActionOptions = {
  readonly onSuccess: (result: { readonly data?: unknown }) => void;
  readonly onError: (result: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

const orderId = "reservation-reopening" as WorkspaceReservationId;
const gatewayUrl = "https://payments.example.test/hpp/order-page";
const getStatusOwnerKey = () =>
  `deskohub:checkout-status-owner:${window.location.pathname}`;
const openPaymentPageError = m.checkoutStatusOpenPaymentPageError(
  {},
  { locale: "en-US" }
);

const renderReopening = ({ isExecuting = false } = {}) => {
  const execute = mock(
    (_input: { readonly locale: string; readonly orderId: string }) => undefined
  );
  workspaceUseAction.mockReturnValue({ execute, isExecuting } as never);
  const view = render(
    <CheckoutStatusPaymentPageReopening
      className="actions"
      locale="en-US"
      orderId={orderId}
    >
      <a href="/en-US">home</a>
    </CheckoutStatusPaymentPageReopening>
  );
  const options = workspaceUseAction.mock.calls.at(-1)?.[1] as
    | ActionOptions
    | undefined;
  if (!options) throw new Error("Reopening action options missing");
  const button = () => {
    const element = view.container.querySelector(
      "#checkout-status-open-payment-page"
    );
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error("Open payment page button missing");
    }
    return element;
  };
  return { button, execute, options, view };
};

describe("CheckoutStatusPaymentPageReopening", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceRouterPush.mockClear();
    workspaceRouterRefresh.mockClear();
    workspaceUseAction.mockClear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.removeItem(getStatusOwnerKey());
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps its alert region mounted before any failure", () => {
    const { view } = renderReopening();

    expect(view.getByRole("alert").textContent).toBe("");
    expect(view.container.querySelector("[aria-live]")).toBeNull();
  });

  test("leads the action row with its button", () => {
    const { button, view } = renderReopening();

    const row = view.container.querySelector(".actions");
    expect(row?.firstElementChild).toBe(button());
    expect(row?.querySelector("a")).not.toBeNull();
  });

  test("asks for the order's payment page with only the order and locale", () => {
    const { button, execute } = renderReopening();

    fireEvent.click(button());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ locale: "en-US", orderId });
  });

  test("is disabled while the request runs", () => {
    const { button, execute } = renderReopening({ isExecuting: true });

    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(execute).not.toHaveBeenCalled();
  });

  test("opens the payment page in a detached tab this status tab owns", () => {
    const paymentWindow = { opener: window };
    const openWindow = spyOn(window, "open").mockImplementation(
      () => paymentWindow as Window
    );
    const { options, view } = renderReopening();

    act(() => {
      options.onSuccess({
        data: { state: "opened", providerRedirectUrl: gatewayUrl },
      });
    });

    expect(openWindow).toHaveBeenCalledWith(gatewayUrl, "_blank");
    expect(paymentWindow.opener).toBeNull();
    // The mounted status page already holds the return; a marker would be
    // copied into the next payment tab it opens.
    expect(sessionStorage.getItem(getStatusOwnerKey())).toBeNull();
    expect(workspaceRouterPush).not.toHaveBeenCalled();
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
    expect(view.getByRole("alert").textContent).toBe("");
  });

  test("sends this tab to the payment page when the browser blocks the new tab", () => {
    spyOn(window, "open").mockReturnValue(null);
    const { options } = renderReopening();

    act(() => {
      options.onSuccess({
        data: { state: "opened", providerRedirectUrl: gatewayUrl },
      });
    });

    expect(workspaceRouterPush).toHaveBeenCalledWith(gatewayUrl);
    expect(sessionStorage.getItem(getStatusOwnerKey())).toBeNull();
  });

  test.each([
    { state: "closed", reason: "window_elapsed" },
    { state: "closed", reason: "paid" },
    { state: "not_found" },
  ])("refreshes the status when the page can't open ($state)", (data) => {
    const openWindow = spyOn(window, "open");
    const { options, view } = renderReopening();

    act(() => {
      options.onSuccess({ data });
    });

    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
    expect(workspaceRouterPush).not.toHaveBeenCalled();
    expect(view.getByRole("alert").textContent).toBe("");
  });

  test("shows the action's public failure", () => {
    const { options, view } = renderReopening();

    act(() => {
      options.onError({ error: { serverError: "Public failure" } });
    });

    expect(view.getByRole("alert").textContent).toBe("Public failure");
    expect(view.getAllByRole("alert")).toHaveLength(1);
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "a failure without a public message",
      fail: (options: ActionOptions) => options.onError({ error: {} }),
    },
    {
      name: "a transport failure",
      fail: (options: ActionOptions) => options.onTransportError(),
    },
    {
      name: "a rejected input",
      fail: (options: ActionOptions) => options.onSuccess({}),
    },
  ])("shows the generic failure after $name", ({ fail }) => {
    const { options, view } = renderReopening();

    act(() => {
      fail(options);
    });

    expect(view.getByRole("alert").textContent).toBe(openPaymentPageError);
  });

  test("clears the failure when the customer tries again", () => {
    const { button, options, view } = renderReopening();
    act(() => {
      options.onTransportError();
    });

    fireEvent.click(button());

    expect(view.getByRole("alert").textContent).toBe("");
  });

  test("keeps the status tab's return lock across repeated reopening", async () => {
    const request = mock(
      (
        _name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<void> | void
      ) => Promise.resolve(callback({ name: "status", mode: "exclusive" }))
    );
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });
    try {
      const paymentWindow = { opener: window };
      const openWindow = spyOn(window, "open").mockImplementation(
        () => paymentWindow as Window
      );
      const closeWindow = spyOn(window, "close");
      render(<CheckoutPaymentWindowCoordinator />);
      const { options } = renderReopening();

      for (const _attempt of [1, 2]) {
        act(() => {
          options.onSuccess({
            data: { state: "opened", providerRedirectUrl: gatewayUrl },
          });
        });
      }

      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      expect(request.mock.calls[0]?.[1]).toEqual({
        ifAvailable: true,
        mode: "exclusive",
      });
      expect(openWindow).toHaveBeenCalledTimes(2);
      expect(sessionStorage.getItem(getStatusOwnerKey())).toBeNull();
      expect(closeWindow).not.toHaveBeenCalled();
    } finally {
      if (originalLocks) {
        Object.defineProperty(navigator, "locks", originalLocks);
      } else {
        Reflect.deleteProperty(navigator, "locks");
      }
    }
  });
});
