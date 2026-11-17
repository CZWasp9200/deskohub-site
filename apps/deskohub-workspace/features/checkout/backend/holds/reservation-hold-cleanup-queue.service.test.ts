import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger } from "effect";
import { makeRecordingAdvisoryLock } from "@/db/postgres-advisory-lock.test-utils";
import type { WorkspaceReservationRow } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "./reservation-hold-cleanup.service";

const now = Temporal.Instant.from("2026-06-01T10:00:00.000Z");
const expiresAt = Temporal.Instant.from("2026-06-01T10:10:00.000Z");
const dueNow = Temporal.Instant.from("2026-06-01T10:10:00.000Z");

const makeReservation = (
  overrides: Partial<WorkspaceReservationRow> = {}
): WorkspaceReservationRow =>
  ({
    id: "order-id",
    checkoutSessionKey: "session-key",
    checkoutAttemptKey: "attempt-key",
    correlationId: "correlation-id",
    dotyposCustomerId: "customer-id",
    dotyposReservationId: "dotypos-reservation-id",
    reservationState: "held",
    paymentState: "not_started",
    fulfillmentState: "not_started",
    activePaymentAttemptId: null,
    productTier: "basic",
    productCoffee: false,
    productMonitorOption: null,
    locale: "en-US",
    reservationHoldExpiresAt: expiresAt,
    reservationHoldExpiredAt: null,
    reservationCreatedAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    reservationConfirmedAt: null,
    reservationCancelledAt: null,
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    updatedAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    ...overrides,
  }) as WorkspaceReservationRow;

const runProcessMessage = async (
  message: Parameters<
    typeof import("./reservation-hold-cleanup-queue.service").processReservationHoldCleanupScheduleMessage
  >[0],
  input: {
    readonly findById?: ReturnType<typeof mock>;
    readonly cancelOrderHold?: ReturnType<typeof mock>;
    readonly now?: Temporal.Instant;
  } = {}
) => {
  const { ReservationHoldCleanupService } = await import(
    "./reservation-hold-cleanup.service"
  );
  const { processReservationHoldCleanupScheduleMessage } = await import(
    "./reservation-hold-cleanup-queue.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const findById =
    input.findById ?? mock(() => Effect.succeed(makeReservation()));
  const cancelOrderHold =
    input.cancelOrderHold ?? mock(() => Effect.succeed("cancelled" as const));

  const result = await processReservationHoldCleanupScheduleMessage(
    message,
    input.now ?? now
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(WorkspaceReservationRepository, {
          findById,
        }),
        Layer.mock(ReservationHoldCleanupService, {
          cancelOrderHold,
          sweepExpiredHolds: mock(() =>
            Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
          ),
        } satisfies ReservationHoldCleanupServiceType)
      )
    ),
    Effect.runPromise
  );

  return { result, findById, cancelOrderHold };
};

/**
 * Delivers `payload` to the real cleanup service over `reservation`. The
 * claim reports whether the cleanup got as far as claiming the hold.
 */
const deliverToCleanup = async (
  payload: Parameters<
    typeof import("./reservation-hold-cleanup-queue.service").processReservationHoldCleanupScheduleMessage
  >[0],
  reservation: WorkspaceReservationRow,
  deliveredAt: Temporal.Instant
) => {
  const { ReservationHoldCleanupService } = await import(
    "./reservation-hold-cleanup.service"
  );
  const { UnpaidHoldRelease } = await import("./unpaid-hold-release.service");
  const { ProviderPaymentFinalizationService } = await import(
    "../payment/provider-payment-finalization.service"
  );
  const { PaymentLifecycleRepository } = await import(
    "../repositories/payment-lifecycle.repository"
  );
  const { processReservationHoldCleanupScheduleMessage } = await import(
    "./reservation-hold-cleanup-queue.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { silentCheckoutAnalytics } = await import(
    "../analytics/checkout-analytics.service.mock"
  );
  const { CheckoutAnalytics } = await import(
    "../analytics/checkout-analytics.service"
  );
  const { DotyposService } = await import("@deskohub/dotypos");
  const claimCancellation = mock(() =>
    Effect.succeed({ ...reservation, reservationState: "cancelling" })
  );
  const lock = makeRecordingAdvisoryLock();
  const result = await processReservationHoldCleanupScheduleMessage(
    payload,
    deliveredAt
  ).pipe(
    Effect.provide(
      ReservationHoldCleanupService.Default.pipe(
        Layer.provide(UnpaidHoldRelease.Default),
        Layer.provide(lock.layer),
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.mock(WorkspaceReservationRepository, {
              findById: mock(() => Effect.succeed(reservation)),
              claimCancellation,
              markCancelled: mock(() => Effect.void),
            } as never),
            Layer.mock(ProviderPaymentFinalizationService, {}),
            Layer.mock(PaymentLifecycleRepository, {}),
            Layer.mock(CheckoutAnalytics, silentCheckoutAnalytics),
            Layer.mock(DotyposService, {
              getReservationStatus: mock(() => Effect.succeed("NEW")),
              cancelReservation: mock(() => Effect.void),
            } as never)
          )
        )
      )
    ),
    Effect.runPromise
  );
  return { result, claimCancellation, lockKeys: lock.entered };
};

const duePayload = {
  schemaVersion: 1,
  orderId: "order-id",
  reservationHoldExpiresAtIso: expiresAt.toString(),
};

describe("ReservationHoldCleanupScheduleService", () => {
  test("builds bounded delayed queue messages with idempotency", async () => {
    const {
      reservationHoldCleanupScheduleMaxDelaySeconds,
      reservationHoldCleanupTopic,
    } = await import("./reservation-hold-cleanup-queue.service");

    const message = reservationHoldCleanupTopic.publication({
      orderId: "order-id" as WorkspaceReservationId,
      reservationHoldExpiresAt: expiresAt,
      now,
    });
    expect(message).toEqual({
      topic: "workspace-reservation-hold-cleanup",
      message: duePayload,
      options: {
        delaySeconds: 600,
        retentionSeconds: 4200,
        idempotencyKey:
          "reservation-hold-cleanup:order-id:2026-06-01T10:10:00Z",
      },
    });
    expect(JSON.stringify(message.message)).toBe(
      '{"schemaVersion":1,"orderId":"order-id","reservationHoldExpiresAtIso":"2026-06-01T10:10:00Z"}'
    );

    const clamped = reservationHoldCleanupTopic.publication({
      orderId: "order-id" as WorkspaceReservationId,
      reservationHoldExpiresAt: Temporal.Instant.from(
        "2026-06-09T10:00:01.000Z"
      ),
      now,
    });
    expect(clamped.options.delaySeconds).toBe(
      reservationHoldCleanupScheduleMaxDelaySeconds
    );
    expect(clamped.options.retentionSeconds).toBe(
      reservationHoldCleanupScheduleMaxDelaySeconds
    );
  });

  test("treats duplicate queue messages as already enqueued", async () => {
    const { ReservationHoldCleanupScheduleService } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { makeMemoryQueue } = await import(
      "@/shared/backend/queue/memory-queue.test-utils"
    );
    const queue = makeMemoryQueue();
    const logs: Array<{ message: unknown; fields: unknown }> = [];
    const captureLogs = Logger.layer([
      Logger.make(({ message }) => {
        const [text, fields] = Array.isArray(message) ? message : [message];
        logs.push({ message: text, fields });
      }),
    ]);
    const enqueue = () =>
      Effect.flatMap(ReservationHoldCleanupScheduleService, (service) =>
        service.enqueueCleanup({
          orderId: "order-id" as WorkspaceReservationId,
          reservationHoldExpiresAt: expiresAt,
        })
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ReservationHoldCleanupScheduleService.Default.pipe(
              Layer.provide(queue.layer)
            ),
            captureLogs
          )
        ),
        Effect.runPromise
      );

    // The second enqueue resolves instead of failing with a schedule error.
    await enqueue();
    await enqueue();
    expect(queue.published()).toHaveLength(1);
    expect(logs.map(({ message }) => message)).toEqual([
      "Reservation hold cleanup enqueue started",
      "Reservation hold cleanup enqueued",
      "Reservation hold cleanup enqueue started",
      "Reservation hold cleanup was already enqueued",
    ]);
    // The logged message keeps its pre-topic shape.
    expect(logs[0]?.fields).toEqual({
      message: {
        topic: "workspace-reservation-hold-cleanup",
        payload: duePayload,
        options: queue.published()[0]?.options,
      },
    });
  });

  test("decodes only well-formed messages", async () => {
    const { reservationHoldCleanupTopic } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { decodeStandardSchema } = await import("@deskohub/standard-schema");

    for (const message of [
      { ...duePayload, schemaVersion: 2 },
      { ...duePayload, orderId: "" },
      { ...duePayload, reservationHoldExpiresAtIso: "tomorrow" },
      { schemaVersion: 1, orderId: "order-id" },
    ]) {
      expect(
        decodeStandardSchema(reservationHoldCleanupTopic.message, message)
      ).toBeUndefined();
    }
    expect(
      decodeStandardSchema(reservationHoldCleanupTopic.message, duePayload)
    ).toEqual(duePayload);
  });

  test("acknowledges a cleanup its order is no longer due for", async () => {
    const result = await runProcessMessage(duePayload, {
      cancelOrderHold: mock(() => Effect.succeed("not_due" as const)),
      now: dueNow,
    });

    expect(result.result).toBe("ignored");
  });

  test("checks under the order's lock that the hold is still the scheduled one", async () => {
    for (const reservation of [
      makeReservation({
        reservationHoldExpiresAt: Temporal.Instant.from(
          "2026-06-01T10:11:00.000Z"
        ),
      }),
      makeReservation({ paymentState: "paid" }),
      makeReservation({ reservationState: "cancelled" }),
      makeReservation({ reservationState: "confirmed" }),
    ]) {
      const delivery = await deliverToCleanup(duePayload, reservation, dueNow);

      expect(delivery.result).toBe("ignored");
      expect(delivery.claimCancellation).not.toHaveBeenCalled();
      expect(delivery.lockKeys).toEqual([["reservation-order", "order-id"]]);
    }
    const early = await deliverToCleanup(
      duePayload,
      makeReservation(),
      dueNow.subtract({ seconds: 1 })
    );
    expect(early.result).toBe("ignored");

    for (const reservationState of [
      "held",
      "cancelling",
      "cancellation_failed",
    ] as const) {
      const delivery = await deliverToCleanup(
        duePayload,
        makeReservation({ reservationState }),
        dueNow
      );
      expect(delivery.result).toBe("cancelled");
      expect(delivery.claimCancellation).toHaveBeenCalledWith({
        id: "order-id",
        expectedHold: {
          dotyposReservationId: "dotypos-reservation-id",
          reservationHoldExpiresAt: expiresAt,
        },
        cause: "hold_expired",
      });
    }
  });

  test("cancels due reservation holds", async () => {
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const result = await runProcessMessage(duePayload, {
      cancelOrderHold,
      now: dueNow,
    });

    expect(result.result).toBe("cancelled");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      holdExpiresAt: expiresAt,
      checkedAt: dueNow,
    });
  });

  test("cancels a due hold whose deadline came from the nanosecond clock", async () => {
    const { reservationHoldCleanupTopic } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { toStoredInstant } = await import("@/db/instant");
    // Temporal.Now has nanoseconds; the reservation row keeps microseconds.
    const clockExpiresAt = Temporal.Instant.from(
      "2026-06-01T10:10:00.123456789Z"
    );
    const storedReservation = makeReservation({
      reservationHoldExpiresAt: toStoredInstant(clockExpiresAt),
    });
    const { message } = reservationHoldCleanupTopic.publication({
      orderId: "order-id" as WorkspaceReservationId,
      reservationHoldExpiresAt: clockExpiresAt,
      now,
    });
    expect(message.reservationHoldExpiresAtIso).toBe(
      "2026-06-01T10:10:00.123456Z"
    );

    for (const payload of [
      message,
      // Messages enqueued before the payload was stored-precision.
      { ...duePayload, reservationHoldExpiresAtIso: clockExpiresAt.toString() },
    ]) {
      const delivery = await deliverToCleanup(
        payload,
        storedReservation,
        dueNow.add({ seconds: 1 })
      );

      expect(delivery.result).toBe("cancelled");
      expect(delivery.claimCancellation).toHaveBeenCalledTimes(1);
    }
  });

  test("redelivers cleanup at the provider cutoff while an empty order is inside it", async () => {
    const { ProviderPaymentDeferral } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { reservationHoldCleanupRedelivery } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { QueueRedelivery } = await import(
      "@/shared/backend/queue/queue-consumer"
    );
    const abandonmentCutoff = dueNow.add({ minutes: 25 });
    const cancelOrderHold = mock(() =>
      Effect.succeed(new ProviderPaymentDeferral({ abandonmentCutoff }))
    );
    const retryNow = dueNow.add({ minutes: 20 });

    const failure = await runProcessMessage(duePayload, {
      cancelOrderHold,
      now: retryNow,
    }).then(
      () => undefined,
      (cause: unknown) => cause
    );

    expect(failure).toMatchObject({
      _tag: "ReservationHoldCleanupDeferredError",
      redeliverAt: abandonmentCutoff,
    });
    expect(reservationHoldCleanupRedelivery(failure)).toEqual(
      QueueRedelivery.At({ instant: abandonmentCutoff })
    );
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      holdExpiresAt: expiresAt,
      checkedAt: retryNow,
    });
  });

  test("redelivers cleanup once another run's fresh cancellation claim is stale", async () => {
    const { HoldCancellationInProgress } = await import(
      "./unpaid-hold-release.service"
    );
    const { reservationHoldCleanupRedelivery } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { QueueRedelivery } = await import(
      "@/shared/backend/queue/queue-consumer"
    );
    const staleAt = dueNow.add({ minutes: 10 });

    const failure = await runProcessMessage(duePayload, {
      cancelOrderHold: mock(() =>
        Effect.succeed(new HoldCancellationInProgress({ staleAt }))
      ),
      now: dueNow,
    }).then(
      () => undefined,
      (cause: unknown) => cause
    );

    expect(reservationHoldCleanupRedelivery(failure)).toEqual(
      QueueRedelivery.At({ instant: staleAt })
    );
  });

  test("acknowledges a hold Dotypos kept and redelivers one whose status can't be read", async () => {
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { UnpaidHoldRelease } = await import("./unpaid-hold-release.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const {
      processReservationHoldCleanupScheduleMessage,
      reservationHoldCleanupRedelivery,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { silentCheckoutAnalytics } = await import(
      "../analytics/checkout-analytics.service.mock"
    );
    const { CheckoutAnalytics } = await import(
      "../analytics/checkout-analytics.service"
    );
    const { DotyposService, DotyposUnavailable } = await import(
      "@deskohub/dotypos"
    );
    const { QueueRedelivery } = await import(
      "@/shared/backend/queue/queue-consumer"
    );

    const deliver = (
      getReservationStatus: () => Effect.Effect<unknown, unknown>
    ) => {
      const cancelReservation = mock(() => Effect.void);
      const markCancellationFailed = mock(() => Effect.void);
      const delivery = processReservationHoldCleanupScheduleMessage(
        duePayload,
        dueNow
      ).pipe(
        Effect.provide(
          ReservationHoldCleanupService.Default.pipe(
            Layer.provide(UnpaidHoldRelease.Default),
            Layer.provide(makeRecordingAdvisoryLock().layer),
            Layer.provideMerge(
              Layer.mergeAll(
                Layer.mock(WorkspaceReservationRepository, {
                  findById: mock(() => Effect.succeed(makeReservation())),
                  claimCancellation: mock(() =>
                    Effect.succeed(
                      makeReservation({ reservationState: "cancelling" })
                    )
                  ),
                  markCancellationFailed,
                } as never),
                Layer.mock(ProviderPaymentFinalizationService, {}),
                Layer.mock(PaymentLifecycleRepository, {}),
                Layer.mock(CheckoutAnalytics, silentCheckoutAnalytics),
                Layer.mock(DotyposService, {
                  getReservationStatus: mock(getReservationStatus),
                  cancelReservation,
                } as never)
              )
            )
          )
        ),
        Effect.result,
        Effect.runPromise
      );
      return { delivery, cancelReservation, markCancellationFailed };
    };

    const kept = deliver(() => Effect.succeed("CONFIRMED"));
    expect(await kept.delivery).toMatchObject({
      _tag: "Success",
      success: "skipped",
    });
    expect(kept.cancelReservation).not.toHaveBeenCalled();
    expect(kept.markCancellationFailed).toHaveBeenCalledWith({
      id: "order-id",
      claimedAt: makeReservation().updatedAt,
      failureCode: "dotypos_cancel_failed",
    });

    const statusUnavailable = new DotyposUnavailable({
      operation: "getReservationStatus",
      reason: "server",
    });
    const unreadable = deliver(() => Effect.fail(statusUnavailable));
    const result = await unreadable.delivery;
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "ReservationHoldCleanupScheduleError",
        cause: {
          _tag: "ReservationHoldCleanupError",
          cause: statusUnavailable,
        },
      },
    });
    expect(
      reservationHoldCleanupRedelivery(
        result._tag === "Failure" ? result.failure : undefined
      )
    ).toEqual(QueueRedelivery.Default());
    expect(unreadable.cancelReservation).not.toHaveBeenCalled();
    expect(unreadable.markCancellationFailed).toHaveBeenCalledWith({
      id: "order-id",
      claimedAt: makeReservation().updatedAt,
      failureCode: "dotypos_cancel_failed",
    });
  });
});
