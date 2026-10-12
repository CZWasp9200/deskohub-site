import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type GetNexiOrderInput,
  NexiCorrelationIdSchema,
  NexiOperationIdSchema,
  type NexiOrder,
  NexiOrderIdSchema,
  type NexiService as NexiServiceTag,
} from "@deskohub/nexi";
import { Duration, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { NexiPaymentAttempt } from "../repositories/payment-attempt.repository";
import type {
  IPaymentRefundRepository,
  RefundablePaymentAttempt,
} from "../repositories/payment-refund.repository";

const providerOrderId = NexiOrderIdSchema.make("provider-order-id");

const attempt: NexiPaymentAttempt = {
  id: paymentAttemptIdSchema.make("attempt-id"),
  workspaceReservationId: workspaceReservationIdSchema.make("reservation-id"),
  provider: "nexi",
  providerOrderId,
  state: "paid",
  refundState: "required",
  refundedAmountValue: null,
  refundedAt: null,
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  providerOrderCreatedAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
  updatedAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
};

const candidate: RefundablePaymentAttempt = {
  attempt,
  correlationId: NexiCorrelationIdSchema.make("correlation-id"),
};

const refundedOrder: NexiOrder = {
  orderId: providerOrderId,
  operations: [
    {
      operationType: "CAPTURE",
      operationResult: "EXECUTED",
      amount: "35000",
    },
    {
      operationId: NexiOperationIdSchema.make("refund-operation-id"),
      operationType: "REFUND",
      // Back-office refunds before settlement are reported as VOIDED.
      operationResult: "VOIDED",
      operationTime: "2026-10-05T08:30:00Z",
      amount: "35000",
    },
  ],
};

const unusedRepositoryCall = () => Effect.die("unused");

const buildService = async (services: {
  readonly getOrder: (typeof NexiServiceTag.Service)["getOrder"];
  readonly recordRefund?: IPaymentRefundRepository["recordRefund"];
  readonly claimRefundChecks?: IPaymentRefundRepository["claimRefundChecks"];
}) => {
  const { NexiService } = await import("@deskohub/nexi");
  const { PaymentRefundRepository } = await import(
    "../repositories/payment-refund.repository"
  );
  const { PaymentRefundService } = await import("./payment-refund.service");

  const layer = PaymentRefundService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(NexiService, { getOrder: services.getOrder }),
        Layer.mock(PaymentRefundRepository, {
          recordRefund: services.recordRefund ?? unusedRepositoryCall,
          claimRefundChecks: services.claimRefundChecks ?? unusedRepositoryCall,
        })
      )
    )
  );

  return <A, E>(
    use: (service: typeof PaymentRefundService.Service) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* PaymentRefundService);
      }).pipe(Effect.provide(layer))
    );
};

describe("PaymentRefundService", () => {
  test("records the refund total and time Nexi reports for the order", async () => {
    const getOrder = mock(() => Effect.succeed(refundedOrder));
    const recordRefund = mock(() => Effect.succeed("recorded" as const));
    const run = await buildService({ getOrder, recordRefund });

    const result = await run((service) => service.reconcileAttempt(candidate));

    expect(result).toBe("recorded");
    expect(getOrder).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
    });
    expect(recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        refundedAmountValue: 35_000,
        refundedAt: Temporal.Instant.from("2026-10-05T08:30:00Z"),
      })
    );
  });

  test("leaves the attempt untouched while Nexi shows no successful refund", async () => {
    const recordRefund = mock(() => Effect.die("not used"));
    const run = await buildService({
      getOrder: () =>
        Effect.succeed({
          ...refundedOrder,
          operations: [
            {
              operationType: "REFUND",
              operationResult: "PENDING",
              amount: "35000",
            },
          ],
        }),
      recordRefund,
    });

    const result = await run((service) => service.reconcileAttempt(candidate));

    expect(result).toBe("no_refund");
    expect(recordRefund).not.toHaveBeenCalled();
  });

  test("keeps reconciling the batch when one provider lookup fails", async () => {
    const recordRefund = mock(() => Effect.succeed("recorded" as const));
    const queue = [
      candidate,
      {
        ...candidate,
        attempt: {
          ...attempt,
          id: paymentAttemptIdSchema.make("failing-attempt-id"),
          providerOrderId: NexiOrderIdSchema.make("failing-order-id"),
        },
      },
    ];
    const claimRefundChecks = mock(
      (input: Parameters<IPaymentRefundRepository["claimRefundChecks"]>[0]) =>
        Effect.sync(() => queue.splice(0, input.limit))
    );
    const run = await buildService({
      claimRefundChecks,
      getOrder: (input: GetNexiOrderInput) =>
        input.orderId === "failing-order-id"
          ? Effect.fail(new Error("provider unavailable"))
          : Effect.succeed(refundedOrder),
      recordRefund,
    });

    const summary = await run((service) =>
      service.reconcileRefunds({
        limit: 25,
        budget: "240 seconds",
        worstCaseLookupDuration: "21 seconds",
      })
    );

    expect(summary).toEqual({ checked: 2, recorded: 1, failed: 1 });
    expect(recordRefund).toHaveBeenCalledTimes(1);
    // Each lookup claims its own attempt; the batch stops once none is left.
    expect(
      claimRefundChecks.mock.calls.every(([claim]) => claim.limit === 1)
    ).toBe(true);
    expect(claimRefundChecks).toHaveBeenCalledWith({
      limit: 1,
      checkedAt: expect.any(Temporal.Instant),
      lastCheckedBefore: expect.any(Temporal.Instant),
      recentPaymentsSince: expect.any(Temporal.Instant),
    });
    const claim = claimRefundChecks.mock.calls[0]?.[0];
    expect(
      claim?.checkedAt.since(claim.recentPaymentsSince).total("hours")
    ).toBe(30 * 24);
    expect(claim?.checkedAt.since(claim.lastCheckedBefore).total("hours")).toBe(
      6
    );
  });

  test("finishes within its budget when every Nexi lookup times out through the retry layer", async () => {
    const { getNexiRequestWorstCaseDuration, NexiRuntimeConfig, NexiService } =
      await import("@deskohub/nexi");
    const { PaymentRefundRepository } = await import(
      "../repositories/payment-refund.repository"
    );
    const { PaymentRefundService } = await import("./payment-refund.service");

    let fetches = 0;
    const unansweredFetch = ((
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      fetches += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true }
        );
      });
    }) as typeof globalThis.fetch;
    const claimed: string[] = [];
    const claimRefundChecks: IPaymentRefundRepository["claimRefundChecks"] = (
      input
    ) =>
      Effect.sync(() =>
        Array.from({ length: input.limit }, () => {
          const id = paymentAttemptIdSchema.make(`attempt-${claimed.length}`);
          claimed.push(id);
          return { ...candidate, attempt: { ...attempt, id } };
        })
      );
    const apiTimeout = 5000;
    const budget = Duration.seconds(240);
    const layer = PaymentRefundService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          NexiService.Live.pipe(
            Layer.provide(
              Layer.succeed(NexiRuntimeConfig, {
                baseUrl: "https://nexi.example.test",
                apiKey: "synthetic-api-key",
                apiTimeout,
              })
            )
          ),
          Layer.mock(PaymentRefundRepository, {
            claimRefundChecks,
            recordRefund: unusedRepositoryCall,
          })
        )
      )
    );

    const { elapsedMilliseconds, summary } = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* PaymentRefundService;
        const batch = yield* Effect.forkChild(
          service.reconcileRefunds({
            limit: 150,
            budget,
            worstCaseLookupDuration:
              getNexiRequestWorstCaseDuration(apiTimeout),
          })
        );
        let elapsedMilliseconds = 0;
        while (batch.pollUnsafe() === undefined) {
          yield* TestClock.adjust("100 millis");
          elapsedMilliseconds += 100;
        }
        return { elapsedMilliseconds, summary: yield* Fiber.join(batch) };
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(FetchHttpClient.Fetch, unansweredFetch),
        Effect.provide(TestClock.layer())
      )
    );

    expect(elapsedMilliseconds).toBeLessThanOrEqual(Duration.toMillis(budget));
    // Each of the four workers fits 11 lookups of about 21 seconds.
    expect(summary.checked).toBe(44);
    expect(summary.failed).toBe(summary.checked);
    // Only attempts the batch actually looked up were claimed and stamped.
    expect(claimed).toHaveLength(summary.checked);
    expect(fetches).toBe(summary.checked * 4);
  });
});
