import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { buildDiscountedCoworkCheckoutSummary } from "@/features/checkout/checkout-quote.test-utils";
import { formatDiscountCountdown } from "@/features/checkout/format-discount-countdown";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutDiscountCountdownBanner } from "./checkout-discount-countdown-banner";

const countdownStartsAt = "2026-08-02T09:00:00.000Z";
const expiresAt = "2026-08-02T10:00:00.000Z";

const countdownMessage = (remainingSeconds: number) =>
  m.checkoutDiscountCountdownBanner(
    {
      discount: "Summer sale",
      remaining: formatDiscountCountdown(
        { value: remainingSeconds, unit: "second" },
        "en-US"
      ),
    },
    { locale: "en-US" }
  );

describe("CheckoutDiscountCountdownBanner", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("counts down every second inside the final hour", () => {
    jest.useFakeTimers({ now: new Date("2026-08-02T09:18:00.000Z") });
    const view = render(
      <CheckoutDiscountCountdownBanner
        locale="en-US"
        summary={buildDiscountedCoworkCheckoutSummary({
          countdownStartsAt,
          expiresAt,
        })}
      />
    );

    const banner = view.getByRole("status");
    expect(banner.textContent).toBe(countdownMessage(42 * 60));
    expect(banner.dataset.tone).toBe("positive");

    act(() => jest.advanceTimersByTime(1000));

    expect(view.getByRole("status").textContent).toBe(
      countdownMessage(42 * 60 - 1)
    );
  });

  test("stays hidden while the countdown is still in hours", () => {
    jest.useFakeTimers({ now: new Date(countdownStartsAt) });
    const view = render(
      <CheckoutDiscountCountdownBanner
        locale="en-US"
        summary={buildDiscountedCoworkCheckoutSummary({
          countdownStartsAt,
          expiresAt,
        })}
      />
    );

    expect(view.queryByRole("status")).toBeNull();

    act(() => jest.advanceTimersByTime(1));

    expect(view.getByRole("status").textContent).toBe(
      countdownMessage(60 * 60)
    );
  });

  test("renders nothing for a discount without a countdown", () => {
    const view = render(
      <CheckoutDiscountCountdownBanner
        locale="en-US"
        summary={buildDiscountedCoworkCheckoutSummary({})}
      />
    );

    expect(view.container.childElementCount).toBe(0);
  });

  test("shows a discount once when it applies to several product rows", () => {
    jest.useFakeTimers({ now: new Date("2026-08-02T09:18:00.000Z") });
    const summary = buildDiscountedCoworkCheckoutSummary({
      countdownStartsAt,
      expiresAt,
    });
    const discountedItem = summary.sections
      .find(({ key }) => key === "order")
      ?.items.find((item) => "discounts" in item && item.discounts);
    if (!discountedItem) {
      throw new Error("Expected a discounted product summary item");
    }
    const secondDiscountedItem = {
      ...discountedItem,
      key: "product:cowork:plus" as const,
      product: { kind: "cowork", tier: "plus" } as const,
    };
    const view = render(
      <CheckoutDiscountCountdownBanner
        locale="en-US"
        summary={{
          ...summary,
          sections: summary.sections.map((section) =>
            section.key === "order"
              ? { ...section, items: [...section.items, secondDiscountedItem] }
              : section
          ),
        }}
      />
    );

    expect(view.getAllByRole("status")).toHaveLength(1);
  });

  test("switches to the expired notice with an attention tone", () => {
    jest.useFakeTimers({ now: new Date("2026-08-02T09:59:59.000Z") });
    const view = render(
      <CheckoutDiscountCountdownBanner
        locale="en-US"
        summary={buildDiscountedCoworkCheckoutSummary({
          countdownStartsAt,
          expiresAt,
        })}
      />
    );

    expect(view.getByRole("status").textContent).toBe(countdownMessage(1));

    act(() => jest.advanceTimersByTime(1000));

    const banner = view.getByRole("status");
    expect(banner.textContent).toBe(
      m.checkoutDiscountExpiredBanner(
        { discount: "Summer sale" },
        { locale: "en-US" }
      )
    );
    expect(banner.dataset.tone).toBe("attention");
  });
});
