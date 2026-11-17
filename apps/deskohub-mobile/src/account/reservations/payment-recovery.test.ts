import { describe, expect, test } from "bun:test";
import {
  type CustomerCheckout,
  CustomerPaymentPageClosedReason,
  CustomerPaymentRetryRefusedReason,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Effect, Exit, Layer, Option } from "effect";
import type { WebBrowserAuthSessionResult } from "expo-web-browser";
import {
  PaymentBrowser,
  type PaymentBrowserResult,
} from "../../booking/payment-browser.service";
import {
  pricedLines,
  sampleSummary,
} from "../../booking/testing/sample-booking-catalog";
import { CustomerSessionCheck } from "../../customer-api/customer-api.service";
import { fakeCustomerApiLayer } from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleDeskOrderId } from "../../customer-api/testing/sample-fixtures";
import {
  bookedSelectionOf,
  PaymentPageOutcome,
  PaymentRecoveryFailed,
  PaymentRetryOutcome,
  paymentRetryRefusal,
  reopenPaymentPage,
  retryPayment,
} from "./payment-recovery";

const orderId = sampleDeskOrderId("payment_failed");

const retried: CustomerCheckout = {
  status: "ready",
  orderId,
  payStateToken: "pay-state-retry",
  expiresAt: "2026-11-20T10:30:00.000Z",
  holdExpiresAt: "2026-11-20T10:10:00.000Z",
  summary: sampleSummary({
    lines: pricedLines({
      family: "cowork",
      tier: "open-space",
      date: "2026-11-26",
    }),
  }),
  earlyPerformanceConsent: {
    required: false,
    requiredFrom: "2026-11-26T00:00:00.000Z",
  },
};

/** Runs `effect` against the fake Workspace, the payment page answering `result`. */
const harness = (result: PaymentBrowserResult = "returned") => {
  const workspace = FakeWorkspace.forKind("linked");
  const opened: Array<readonly [string, string]> = [];
  const layer = Layer.mergeAll(
    fakeCustomerApiLayer(workspace),
    Layer.succeed(CustomerSessionCheck, { recheck: Effect.void }),
    PaymentBrowser.fromAuthSession((url, redirectUrl) => {
      opened.push([url, redirectUrl]);
      return Promise.resolve(
        (result === "returned"
          ? { type: "success", url: redirectUrl }
          : { type: "dismiss" }) as WebBrowserAuthSessionResult
      );
    })
  );
  const run = <A, E>(
    effect: Effect.Effect<A, E, Layer.Success<typeof layer>>
  ) => Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));
  return { workspace, opened, run };
};

describe("reopenPaymentPage", () => {
  test.each(["returned", "dismissed"] as const)(
    "opens the page the server hands back, returning to the order's status (%s)",
    async (result) => {
      const { workspace, opened, run } = harness(result);
      workspace.paymentPage = { url: "https://gateway.example.test/pay/1" };
      const exit = await run(reopenPaymentPage(orderId));
      expect(exit).toEqual(Exit.succeed(PaymentPageOutcome.Opened({ result })));
      expect(opened).toEqual([
        [
          "https://gateway.example.test/pay/1",
          `deskohub://reservations/${orderId}?after=payment`,
        ],
      ]);
    }
  );

  test.each([...CustomerPaymentPageClosedReason.literals])(
    "a page the server won't reopen (%s) opens nothing and says why",
    async (reason) => {
      const { workspace, opened, run } = harness();
      workspace.paymentPage = reason;
      const exit = await run(reopenPaymentPage(orderId));
      expect(exit).toEqual(Exit.succeed(PaymentPageOutcome.Closed({ reason })));
      expect(opened).toEqual([]);
    }
  );

  test("an order that isn't the account's is not found", async () => {
    const { run } = harness();
    const exit = await run(
      reopenPaymentPage(CustomerReservationOrderId.make("sample-order-unknown"))
    );
    expect(exit).toEqual(Exit.succeed(PaymentPageOutcome.NotFound()));
  });

  test("an unavailable service is a retryable failure", async () => {
    const { workspace, opened, run } = harness();
    workspace.paymentPage = { url: "https://gateway.example.test/pay/1" };
    workspace.fail("reopenPaymentPage", "service-unavailable");
    const exit = await run(reopenPaymentPage(orderId));
    expect(exit).toEqual(
      Exit.fail(new PaymentRecoveryFailed({ kind: "service_unavailable" }))
    );
    expect(opened).toEqual([]);
  });
});

describe("retryPayment", () => {
  test.each(["ready", "price_review"] as const)(
    "hands back the order's checkout to confirm and pay (%s)",
    async (status) => {
      const { workspace, run } = harness();
      const checkout: CustomerCheckout =
        status === "ready"
          ? retried
          : {
              ...retried,
              status,
              priceReview: {
                changedKeys: { sectionKeys: ["total"], itemKeys: [] },
              },
            };
      workspace.paymentRetry = checkout;
      const exit = await run(retryPayment(orderId, "en-US"));
      expect(exit).toEqual(
        Exit.succeed(PaymentRetryOutcome.Checkout({ checkout }))
      );
    }
  );

  test.each([...CustomerPaymentRetryRefusedReason.literals])(
    "a refused retry (%s) says what is left to do",
    async (reason) => {
      const { workspace, run } = harness();
      workspace.paymentRetry = reason;
      const exit = await run(retryPayment(orderId, "en-US"));
      expect(exit).toEqual(Exit.succeed(paymentRetryRefusal(reason)));
    }
  );

  test("an unavailable service is a retryable failure", async () => {
    const { workspace, run } = harness();
    workspace.paymentRetry = retried;
    workspace.fail("retryPayment", "service-unavailable");
    const exit = await run(retryPayment(orderId, "en-US"));
    expect(exit).toEqual(
      Exit.fail(new PaymentRecoveryFailed({ kind: "service_unavailable" }))
    );
  });
});

describe("paymentRetryRefusal", () => {
  test("a payment that may still settle is checked later, never booked again", () => {
    expect(paymentRetryRefusal("payment_settling")).toEqual(
      PaymentRetryOutcome.CheckLater()
    );
  });

  test("every other refusal books the same selection again", () => {
    for (const reason of CustomerPaymentRetryRefusedReason.literals) {
      if (reason === "payment_settling") continue;
      expect(paymentRetryRefusal(reason)).toEqual(
        PaymentRetryOutcome.BookAgain({ reason })
      );
    }
  });
});

describe("bookedSelectionOf", () => {
  test("takes the order's own selection first", () => {
    expect(
      bookedSelectionOf(
        { bookedSelection: "order" },
        Option.some({ bookedSelection: "saved" })
      )
    ).toBe("order");
  });

  test("falls back to the saved reservation's selection once the order dropped it", () => {
    expect(
      bookedSelectionOf<string>({}, Option.some({ bookedSelection: "saved" }))
    ).toBe("saved");
    expect(bookedSelectionOf<string>({}, Option.none())).toBeUndefined();
  });
});
