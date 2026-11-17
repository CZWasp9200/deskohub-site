import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Duration } from "effect";
import { payStateTokenQueryParam } from "@/features/checkout/backend/checkout/pay-state";
import type { ClearDiscountCodeInput } from "@/features/checkout/backend/checkout/pay-state-discount-code-input";
import type { WorkspaceActionOptions } from "@/shared/backend/workspace-action";
import type { ClearDiscountCodeActionResult } from "./clear-discount-code";

mock.module("server-only", () => ({}));

const redirectMock = mock((_url: string) => {
  throw new Error("NEXT_REDIRECT");
});

mock.module("next/navigation", () => ({
  redirect: redirectMock,
  RedirectType: { replace: "replace" },
  unstable_rethrow: () => undefined,
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  permanentRedirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

// The shared operation's tests cover removing the code; here the result is
// stubbed so the redirect routing is what runs.
mock.module("@/shared/backend/workspace-action", () => ({
  defineWorkspaceAction:
    (_options: WorkspaceActionOptions<never>, _handler: never) =>
    async (input: ClearDiscountCodeInput) => {
      actionInputs.push(input);
      return { data: operationResult };
    },
  workspaceActionDeadline: Duration.seconds(45),
}));

let operationResult: ClearDiscountCodeActionResult | undefined;
const actionInputs: Array<ClearDiscountCodeInput> = [];

const runForm = async (
  result: ClearDiscountCodeActionResult | undefined,
  input: { readonly locale?: string; readonly payStateToken: string }
) => {
  operationResult = result;
  actionInputs.length = 0;
  redirectMock.mockClear();
  const { clearDiscountCodeForm } = await import("./clear-discount-code");

  let redirectError: unknown;
  try {
    await clearDiscountCodeForm(
      // Server Action arguments are untrusted; tests may tamper with them.
      (input.locale ?? "en-US") as Parameters<typeof clearDiscountCodeForm>[0],
      input.payStateToken
    );
  } catch (error) {
    redirectError = error;
  }

  expect(redirectError).toBeInstanceOf(Error);
  expect((redirectError as Error).message).toBe("NEXT_REDIRECT");
  expect(redirectMock).toHaveBeenCalledTimes(1);
  return new URL(
    redirectMock.mock.calls[0]?.[0] as string,
    "https://deskohub.test"
  );
};

describe("clearDiscountCodeForm", () => {
  test.each(["cleared", "unchanged"] as const)(
    "redirects a %s result to the Pay state it returned",
    async (status) => {
      const freshPayUrl = "/en-US/checkout/pay?payState=fresh-review-state";

      const url = await runForm(
        {
          status,
          freshPayUrl,
          freshPayStateToken: "fresh-review-state",
          expiresAt: "2026-06-01T10:08:00Z",
        },
        { payStateToken: "original-token" }
      );

      expect(`${url.pathname}${url.search}`).toBe(freshPayUrl);
      expect(actionInputs).toEqual([
        { locale: "en-US", payStateToken: "original-token" },
      ]);
    }
  );

  test.each([
    { status: "unavailable", reason: "provider" },
    { status: "unavailable", reason: "price_review_pending" },
    {
      status: "unavailable",
      reason: "checkout",
      checkoutReason: "payment_in_progress",
    },
    { status: "unavailable", reason: "checkout", checkoutReason: "expired" },
    undefined,
  ] as const)(
    "routes a removal that failed back to the original token with the generic field error: %o",
    async (result) => {
      const url = await runForm(result, { payStateToken: "original-token" });

      expect(url.pathname).toBe("/en-US/checkout/pay");
      expect(url.searchParams.get(payStateTokenQueryParam)).toBe(
        "original-token"
      );
      expect(url.searchParams.get("discountCodeError")).toBe("unavailable");
      expect(url.searchParams.get("discountCodeErrorId")).toBeTruthy();
    }
  );

  test("routes an automated request back with its error", async () => {
    const url = await runForm(
      { status: "automated_request" },
      { payStateToken: "original-token" }
    );

    expect(url.searchParams.get(payStateTokenQueryParam)).toBe(
      "original-token"
    );
    expect(url.searchParams.get("discountCodeError")).toBe("automated-request");
  });

  test("never redirects off-site when the action is invoked with a tampered locale", async () => {
    const url = await runForm(
      { status: "unavailable", reason: "provider" },
      { locale: "/evil.example", payStateToken: "original-token" }
    );

    expect(url.host).toBe("deskohub.test");
    expect(url.pathname).toMatch(/^\/[a-z]{2}(-[A-Z]{2})?\/checkout\/pay$/);
  });
});
