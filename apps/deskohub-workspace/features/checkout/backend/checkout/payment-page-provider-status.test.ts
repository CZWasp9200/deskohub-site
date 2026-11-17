import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { type NexiOrder, NexiService } from "@deskohub/nexi";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  type PaymentPageProviderObservation,
  PaymentPageProviderStatus,
} from "./payment-page-provider-status";

const reservation = { correlationId: "correlation-id" } as never;
const attempt = { providerOrderId: "provider-order-id" } as never;

const observeWith = (getOrder: ReturnType<typeof mock>) =>
  PaymentPageProviderStatus.pipe(
    Effect.flatMap((status) => status.observe({ attempt, reservation })),
    Effect.provide(
      PaymentPageProviderStatus.Default.pipe(
        Layer.provide(Layer.mock(NexiService, { getOrder } as never))
      )
    )
  );

const order = (overrides: Partial<NexiOrder> = {}) => ({
  orderId: "provider-order-id",
  operations: [],
  ...overrides,
});

describe("PaymentPageProviderStatus.observe", () => {
  test.each<
    readonly [string, Partial<NexiOrder>, PaymentPageProviderObservation]
  >([
    ["an order without operations or amounts", {}, "no_activity"],
    [
      "an order with zero amounts",
      { authorizedAmount: "0", capturedAmount: "0" },
      "no_activity",
    ],
    [
      "an order Nexi cancelled",
      {
        operations: [
          { operationType: "AUTHORIZATION", operationResult: "CANCELED" },
        ],
      },
      "activity",
    ],
    [
      "an order with an authorized amount",
      { authorizedAmount: "100" },
      "activity",
    ],
  ])("reads %s as %s", async (_label, overrides, expected) => {
    const getOrder = mock(() => Effect.succeed(order(overrides)));

    expect(await Effect.runPromise(observeWith(getOrder))).toBe(expected);
    expect(getOrder).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
    });
  });

  test("reads a failed lookup as unknown", async () => {
    const getOrder = mock(() => Effect.fail(new Error("nexi down")));

    expect(await Effect.runPromise(observeWith(getOrder))).toBe("unknown");
  });

  test("reads a lookup that outlasts one request as unknown", async () => {
    const getOrder = mock(() => Effect.never);

    const observation = await Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(observeWith(getOrder));
      yield* TestClock.adjust("1 minute");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

    expect(observation).toBe("unknown");
  });

  test("asks nothing for an attempt without a provider order", async () => {
    const getOrder = mock(() => Effect.succeed(order()));

    const observation = await PaymentPageProviderStatus.pipe(
      Effect.flatMap((status) =>
        status.observe({
          attempt: { providerOrderId: null } as never,
          reservation,
        })
      ),
      Effect.provide(
        PaymentPageProviderStatus.Default.pipe(
          Layer.provide(Layer.mock(NexiService, { getOrder } as never))
        )
      ),
      Effect.runPromise
    );

    expect(observation).toBe("unknown");
    expect(getOrder).not.toHaveBeenCalled();
  });
});
