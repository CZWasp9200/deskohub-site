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
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  buildCoworkCheckoutSummary,
  buildCoworkReservationQuote as buildCoworkPriceQuote,
  buildDiscountedCoworkCheckoutSummary,
} from "@/features/checkout/checkout-quote.test-utils";
import { formatDiscountCountdown } from "@/features/checkout/format-discount-countdown";
import { m } from "@/features/i18n";
import {
  workspaceRouterPush,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const buildCoworkReservationQuote = (
  ...args: Parameters<typeof buildCoworkPriceQuote>
) => ({
  ...buildCoworkPriceQuote(...args),
  summary: buildCoworkCheckoutSummary(...args),
});

const { submitWorkspaceReservation } = await import(
  "@/features/reservation/actions/submit-reservation"
);

mock.module("server-only", () => ({}));
const submitReservationActions = await import(
  "@/features/reservation/actions/submit-reservation"
);
mock.module("@/features/reservation/actions/submit-reservation", () => ({
  ...submitReservationActions,
  submitReservation: mock(),
  submitWorkspaceReservation,
}));

beforeEach(() => {
  workspaceUseAction.mockReturnValue({
    execute: mock(),
    isExecuting: false,
    result: {},
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("CheckoutPayPageSkeleton", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders skeleton order details with a disabled submit button", async () => {
    const { CheckoutPayPageSkeleton } = await import("./checkout-pay-page");
    const view = render(<CheckoutPayPageSkeleton locale="en-US" />);
    const submitButton = view.getByRole("button") as HTMLButtonElement;

    expect(submitButton.disabled).toBe(true);
    expect(
      view.getByText(m.checkoutSummarySectionOrder({}, { locale: "en-US" }))
    ).toBeDefined();
    expect(
      view.container.querySelectorAll(
        "[data-slot='skeleton'][aria-hidden='true']"
      ).length
    ).toBeGreaterThan(0);
  });
});

describe("CheckoutPayPage pricing change", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("requires review before exposing payment controls", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const freshPayUrl = "/en-US/checkout/pay?payState=fresh";
    const view = render(
      <CheckoutPayPage
        changedKeys={{
          sectionKeys: ["order", "total"],
          itemKeys: ["product:cowork:basic", "total:final"],
        }}
        freshPayUrl={freshPayUrl}
        locale="en-US"
        summary={quote.summary}
        variant="pricingChanged"
      />
    );

    expect(
      view.getByText(m.checkoutPayPricingChangedTitle({}, { locale: "en-US" }))
    ).toBeDefined();
    const reviewLink = view.getByRole("link", {
      name: m.checkoutPayReviewUpdatedPriceButton({}, { locale: "en-US" }),
    });
    expect(reviewLink.getAttribute("href")).toBe(freshPayUrl);
    expect(
      view.queryByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    ).toBeNull();
    expect(view.queryByRole("checkbox")).toBeNull();
  });
});

describe("CheckoutPayPage payment navigation", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceRouterPush.mockClear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.removeItem(
      "deskohub:checkout-status-owner:/en-US/reservation/status/reservation-id"
    );
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("opens the payment gateway in a new tab and sends the original tab to status", async () => {
    const events: string[] = [];
    const execute = mock(() => {
      events.push("execute");
    });
    const paymentWindow = {
      opener: window,
    };
    const openPaymentWindow = spyOn(window, "open").mockImplementation(() => {
      events.push("open");
      return paymentWindow as Window;
    });
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });

    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        discountCodeForm={<button type="button">Apply discount</button>}
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );

    expect(view.getByRole("button", { name: "Apply discount" })).toBeDefined();
    expect(view.getAllByRole("checkbox")).toHaveLength(1);
    expect(
      view.getByRole("checkbox", { name: /statutory withdrawal period/ })
    ).toBeDefined();
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    );

    expect(events).toEqual(["execute"]);
    expect(execute).toHaveBeenCalledWith({
      locale: "en-US",
      payStateToken: "signed-summary",
      legalConsent: true,
      earlyPerformanceConsent: true,
    });

    const actionOptions = workspaceUseAction.mock.calls.at(-1)?.[1] as
      | {
          readonly onSuccess: (result: {
            readonly data: {
              readonly status: "redirect";
              readonly redirectUrl: string;
              readonly statusUrl: string;
            };
          }) => void;
        }
      | undefined;
    if (!actionOptions) throw new Error("Checkout action options missing");

    act(() => {
      actionOptions.onSuccess({
        data: {
          status: "redirect",
          redirectUrl: "https://payments.example.test/checkout",
          statusUrl: "/en-US/reservation/status/reservation-id",
        },
      });
    });

    expect(events).toEqual(["execute", "open"]);
    expect(openPaymentWindow).toHaveBeenCalledTimes(1);
    expect(openPaymentWindow).toHaveBeenCalledWith(
      "https://payments.example.test/checkout",
      "_blank"
    );
    expect(paymentWindow.opener).toBeNull();
    expect(workspaceRouterPush).toHaveBeenCalledWith(
      "/en-US/reservation/status/reservation-id"
    );
    expect(
      sessionStorage.getItem(
        "deskohub:checkout-status-owner:/en-US/reservation/status/reservation-id"
      )
    ).toBe("true");
  });

  test("announces a payment start failure as an alert", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );
    expect(view.queryByRole("alert")).toBeNull();

    const actionOptions = workspaceUseAction.mock.calls.at(-1)?.[1] as
      | { readonly onTransportError: () => void }
      | undefined;
    if (!actionOptions) throw new Error("Checkout action options missing");

    act(() => {
      actionOptions.onTransportError();
    });

    expect(view.getByRole("alert").textContent).toBe(
      m.checkoutPaySubmitError({}, { locale: "en-US" })
    );
  });

  test("omits the early-performance request when the withdrawal period has elapsed", async () => {
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const quote = buildCoworkReservationQuote({
      entryTier: "basic",
      coffee: false,
    });
    const view = render(
      <CheckoutPayPage
        earlyPerformanceRequestRequired={false}
        locale="en-US"
        payStateToken="signed-summary"
        summary={quote.summary}
        variant="pay"
      />
    );

    expect(view.getAllByRole("checkbox")).toHaveLength(1);
    expect(
      view.queryByRole("checkbox", { name: /statutory withdrawal period/ })
    ).toBeNull();
    expect(
      view
        .getByRole("link", { name: "General Terms and Conditions" })
        .getAttribute("href")
    ).toBe("/en-US/terms-and-conditions");
    expect(
      view.getByRole("link", { name: "Operating Rules" }).getAttribute("href")
    ).toBe("/en-US/operating-rules");
  });

  test("does not open a payment tab for an internal zero-total checkout", async () => {
    const openPaymentWindow = spyOn(window, "open");
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
      result: {},
    });

    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={buildDiscountedCoworkCheckoutSummary({ basisPoints: 10_000 })}
        variant="pay"
      />
    );

    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(
      view.getByRole("button", {
        name: m.checkoutPayOrderAndPayButton({}, { locale: "en-US" }),
      })
    );

    const actionOptions = workspaceUseAction.mock.calls.at(-1)?.[1] as
      | {
          readonly onSuccess: (result: {
            readonly data: {
              readonly status: "redirect";
              readonly redirectUrl: string;
              readonly statusUrl?: string;
            };
          }) => void;
        }
      | undefined;
    if (!actionOptions) throw new Error("Checkout action options missing");

    act(() => {
      actionOptions.onSuccess({
        data: {
          status: "redirect",
          redirectUrl:
            "/en-US/reservation/status/reservation-id?outcome=success",
        },
      });
    });

    expect(openPaymentWindow).not.toHaveBeenCalled();
    expect(workspaceRouterPush).toHaveBeenCalledWith(
      "/en-US/reservation/status/reservation-id?outcome=success"
    );
  });
});

describe("CheckoutPayPage discount urgency", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("mounts the discount countdown banner", async () => {
    jest.useFakeTimers({
      now: new Date("2026-08-02T09:18:00.000Z"),
    });
    const { CheckoutPayPage } = await import("./checkout-pay-page");
    const view = render(
      <CheckoutPayPage
        locale="en-US"
        payStateToken="signed-summary"
        summary={buildDiscountedCoworkCheckoutSummary({
          countdownStartsAt: "2026-08-02T09:00:00.000Z",
          expiresAt: "2026-08-02T10:00:00.000Z",
        })}
        variant="pay"
      />
    );

    expect(view.getByRole("status").textContent).toBe(
      m.checkoutDiscountCountdownBanner(
        {
          discount: "Summer sale",
          remaining: formatDiscountCountdown(
            { value: 42 * 60, unit: "second" },
            "en-US"
          ),
        },
        { locale: "en-US" }
      )
    );
  });
});
