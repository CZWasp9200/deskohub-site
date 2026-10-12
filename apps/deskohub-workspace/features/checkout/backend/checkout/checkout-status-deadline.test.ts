import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { SeatingMapFeatureFlagServiceMock } from "@/features/feature-flags/backend/seating-map-feature-flag.service.mock";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { makeWorkspaceNexiLayer } from "@/shared/backend/config/nexi.config";
import { WorkspacePaidFulfillmentService } from "../fulfillment/paid-fulfillment.service";
import { PaidFulfillmentQueueService } from "../fulfillment/paid-fulfillment-queue.service";
import { LatePaymentVerificationService } from "../payment/late-payment-verification.service";
import { ProviderPaymentFinalizationService } from "../payment/provider-payment-finalization.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentAttemptRepository } from "../repositories/payment-attempt.repository";
import { PaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { CheckoutStatusService } from "./checkout-status.service";
import { loadCheckoutStatusPage } from "./checkout-status-page.server";

mock.module("server-only", () => ({}));

/** The status page route's `maxDuration`. */
const statusPageMaxDurationSeconds = 60;

const orderId = workspaceReservationIdSchema.make("reservation-stalled-nexi");
const createdAt = Temporal.Instant.from("2026-06-01T10:00:00Z");

const pendingReservation = {
  id: orderId,
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  reservationDetails: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
  },
  locale: "en-US",
  reservationState: "held",
  paymentState: "pending",
  fulfillmentState: "not_started",
  activePaymentAttemptId: "attempt-stalled-nexi",
  createdAt,
  updatedAt: createdAt,
};

const pendingAttempt = {
  id: "attempt-stalled-nexi",
  workspaceReservationId: orderId,
  provider: "nexi" as const,
  providerOrderId: "provider-order-id",
  state: "pending" as const,
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  providerOrderCreatedAt: createdAt,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt,
  updatedAt: createdAt,
};

/** A Nexi sandbox that accepts connections and never answers. */
const stalledFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

test("renders the stored status within the route limit when Nexi and Dotypos stall", async () => {
  const getReservationWithoutCustomer = mock(() => Effect.never);
  const getCustomer = mock(() => Effect.never);
  const startRecoveryIfSettled = mock(() =>
    Effect.succeed("not_applicable" as const)
  );

  const { elapsedSeconds, status } = await Effect.gen(function* () {
    const checkoutStatus = yield* CheckoutStatusService;
    const page = yield* Effect.forkChild(
      loadCheckoutStatusPage(
        checkoutStatus,
        { isAuthorized: () => Effect.succeed(true) },
        { locale: "en-US", orderId, returnOutcome: "success" }
      ).pipe(Effect.provideService(FetchHttpClient.Fetch, stalledFetch))
    );
    let elapsedSeconds = 0;
    while (
      page.pollUnsafe() === undefined &&
      elapsedSeconds < statusPageMaxDurationSeconds
    ) {
      yield* TestClock.adjust("1 second");
      elapsedSeconds += 1;
    }
    if (page.pollUnsafe() === undefined) {
      yield* Fiber.interrupt(page);
      return { elapsedSeconds, status: undefined };
    }
    return { elapsedSeconds, status: yield* Fiber.join(page) };
  }).pipe(
    Effect.provide(
      CheckoutStatusService.Default.pipe(
        Layer.provide(
          ProviderPaymentFinalizationService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                makeWorkspaceNexiLayer("preview"),
                Layer.mock(PaymentLifecycleRepository, {}),
                Layer.mock(PaidFulfillmentQueueService, {}),
                Layer.mock(WorkspacePaidFulfillmentService, {}),
                Layer.mock(PostHogEventService, {})
              )
            )
          )
        ),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WorkspaceReservationRepository, {
              findById: () => Effect.succeed(pendingReservation as never),
            }),
            Layer.mock(PaymentAttemptRepository, {
              findById: () => Effect.succeed(pendingAttempt as never),
              findDisplayableForReservation: () => Effect.succeed(null),
            }),
            Layer.mock(LatePaymentRecoveryRepository, {
              findLatestByWorkspaceReservationId: () => Effect.succeed(null),
            }),
            Layer.mock(LatePaymentVerificationService, {
              startRecoveryIfSettled,
            }),
            Layer.mock(DotyposService, {
              getReservationWithoutCustomer,
              getCustomer,
            }),
            Layer.mock(AdvisoryAvailabilityInventory, {
              tables: Effect.never,
            }),
            SeatingMapFeatureFlagServiceMock({
              isEnabled: Effect.succeed(true),
            })
          )
        )
      )
    ),
    Effect.provide(TestClock.layer()),
    Effect.runPromise
  );

  expect(status).toMatchObject({
    orderId,
    status: "pending",
    paymentStatus: "pending",
  });
  // One full 30-second sandbox lookup ran before the deadline stopped retries.
  expect(elapsedSeconds).toBeGreaterThan(30);
  expect(elapsedSeconds).toBeLessThan(statusPageMaxDurationSeconds);
  expect(startRecoveryIfSettled).not.toHaveBeenCalled();
});
