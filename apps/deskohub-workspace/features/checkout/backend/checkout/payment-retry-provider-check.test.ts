import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { type NexiOrder, NexiService } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { PaymentAttempt } from "../repositories/payment-attempt.repository";
import { PaymentRetryProviderCheck } from "./payment-retry-provider-check";
import { PaymentRetryUnavailableError } from "./payment-retry-unavailable";

const check = (
  order: Partial<NexiOrder> | Error,
  attempt: Pick<PaymentAttempt, "providerOrderId"> = {
    providerOrderId: "provider-order-id" as never,
  }
) =>
  PaymentRetryProviderCheck.pipe(
    Effect.flatMap((providerCheck) =>
      providerCheck.check({
        attempt,
        reservation: { correlationId: "correlation-id" as never },
      })
    ),
    Effect.provide(
      PaymentRetryProviderCheck.Default.pipe(
        Layer.provide(
          Layer.mock(NexiService, {
            getOrder: () =>
              order instanceof Error
                ? Effect.fail(order as never)
                : Effect.succeed({
                    orderId: "provider-order-id",
                    operations: [],
                    ...order,
                  } as NexiOrder),
          })
        )
      )
    ),
    Effect.result,
    Effect.runPromise
  );

describe("PaymentRetryProviderCheck", () => {
  test.each([
    ["no operation", []],
    [
      "a failed 3-D Secure authorization",
      [{ operationType: "AUTHORIZATION", operationResult: "THREEDS_FAILED" }],
    ],
    [
      "an abandoned authorization",
      [{ operationType: "AUTHORIZATION", operationResult: "CANCELED" }],
    ],
  ])("lets a payment with %s be retried", async (_name, operations) => {
    expect(await check({ operations })).toMatchObject({
      success: "ended_unpaid",
    });
  });

  test.each([
    [
      "an executed authorization",
      {
        operations: [
          { operationType: "AUTHORIZATION", operationResult: "EXECUTED" },
        ],
      },
    ],
    [
      "a pending operation",
      {
        operations: [{ operationType: "CAPTURE", operationResult: "PENDING" }],
      },
    ],
    [
      "a voided authorization",
      { operations: [{ operationType: "VOID", operationResult: "EXECUTED" }] },
    ],
    [
      "an operation of unknown type",
      {
        operations: [
          { operationType: "CARD_VERIFICATION", operationResult: "DECLINED" },
        ],
      },
    ],
    ["an authorized amount", { authorizedAmount: "29000" }],
    ["a captured amount", { capturedAmount: "29000" }],
  ])("refuses while the provider shows %s", async (_name, order) => {
    expect(await check(order)).toMatchObject({ success: "may_settle" });
  });

  test("reports an attempt without a provider order", async () => {
    expect(await check({}, { providerOrderId: null })).toMatchObject({
      success: "no_provider_order",
    });
  });

  test("fails as unavailable when the provider can't be asked", async () => {
    expect(await check(new Error("network"))).toMatchObject({
      failure: expect.any(PaymentRetryUnavailableError),
    });
  });
});
