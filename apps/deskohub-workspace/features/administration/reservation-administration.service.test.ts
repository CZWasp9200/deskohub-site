import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

test("operator cancellation cancels Dotypos, records the result, and optionally emails", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const { ReservationCancellation } = await import(
    "@/features/reservation/backend/reservation-cancellation.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-test"
  );
  const current = {
    id,
    dotyposReservationId: "dotypos-test",
    fulfillmentState: "fulfilled",
    reservationState: "confirmed",
    updatedAt: Temporal.Now.instant(),
  } as never;
  const details = {
    id,
    dotyposReservationId: "dotypos-test",
    providerStatus: "CONFIRMED",
  } as never;
  const cancelReservation = mock(() => Effect.void);
  const claimRequestedCancellation = mock(() => Effect.succeed(current));
  const completeRequestedCancellation = mock(() => Effect.void);
  const sendCancellationEmail = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation }),
            Layer.mock(WorkspaceReservationEmailService, {
              sendCancellationEmail,
            }),
            Layer.mock(WorkspaceReservationRepository, {
              claimRequestedCancellation,
              findById: () => Effect.succeed(current),
              markRequestedCancellationFailed: () => Effect.void,
              completeRequestedCancellation,
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.succeed(details),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({ outcome: "cancelled", email: "sent" });
  expect(cancelReservation).toHaveBeenCalledWith("dotypos-test");
  expect(completeRequestedCancellation).toHaveBeenCalledWith({
    id,
    cancelledAt: expect.any(Temporal.Instant),
    claimedAt: current.updatedAt,
    failureCode: null,
  });
  expect(claimRequestedCancellation).toHaveBeenCalledWith({
    id,
    cause: "operator",
    staleCancellingBefore: expect.any(Temporal.Instant),
  });
  expect(sendCancellationEmail).toHaveBeenCalledWith({ reservation: details });
});

test("forced operator cancellation terminalizes a pending payment before cancelling", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const { ReservationCancellation } = await import(
    "@/features/reservation/backend/reservation-cancellation.service"
  );
  const id = workspaceReservationIdSchema.make("reservation-pending");
  const activePaymentAttemptId = paymentAttemptIdSchema.make("payment-pending");
  const current = {
    id,
    activePaymentAttemptId,
    dotyposReservationId: "dotypos-pending",
    fulfillmentState: "not_started",
    paymentState: "pending",
    reservationState: "held",
    updatedAt: Temporal.Now.instant(),
  } as never;
  const details = {
    id,
    dotyposReservationId: "dotypos-pending",
    providerStatus: "NEW",
  } as never;
  const cancelReservation = mock(() => Effect.void);
  const completeRequestedCancellation = mock(() => Effect.void);
  const claimRequestedCancellation = mock(() => Effect.succeed(current));

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      force: true,
      reservationId: id,
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation }),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimRequestedCancellation,
              findById: () => Effect.succeed(current),
              markRequestedCancellationFailed: () => Effect.void,
              completeRequestedCancellation,
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.succeed(details),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({ outcome: "cancelled", email: "not_requested" });
  expect(claimRequestedCancellation).toHaveBeenCalledWith({
    id,
    cause: "operator",
    pendingPaymentCancellation: {
      paymentAttemptId: activePaymentAttemptId,
      failureCode: "admin_forced_payment_cancellation",
    },
    staleCancellingBefore: expect.any(Temporal.Instant),
  });
  expect(cancelReservation).toHaveBeenCalledWith("dotypos-pending");
  expect(completeRequestedCancellation).toHaveBeenCalledWith({
    id,
    cancelledAt: expect.any(Temporal.Instant),
    claimedAt: current.updatedAt,
    failureCode: "admin_forced_payment_cancellation",
  });
});

test("retrying an already-cancelled reservation does not email again", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const { ReservationCancellation } = await import(
    "@/features/reservation/backend/reservation-cancellation.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-cancelled"
  );
  const sendCancellationEmail = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {}),
            Layer.mock(WorkspaceReservationEmailService, {
              sendCancellationEmail,
            }),
            Layer.mock(WorkspaceReservationRepository, {
              findById: () =>
                Effect.succeed({ id, reservationState: "cancelled" } as never),
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.die("details must not be loaded"),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({
    outcome: "already_cancelled",
    email: "not_requested",
  });
  expect(sendCancellationEmail).not.toHaveBeenCalled();
});

test("refuses cancellation while the confirmation email is still delivering", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationError, ReservationAdministrationService } =
    await import("./reservation-administration.service");
  const { ReservationCancellation } = await import(
    "@/features/reservation/backend/reservation-cancellation.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-awaiting-delivery"
  );
  const cancelReservation = mock(() =>
    Effect.die("awaiting delivery must not cancel at the provider")
  );
  const claimRequestedCancellation = mock(() =>
    Effect.die("awaiting delivery must not claim cancellation")
  );

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation }),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimRequestedCancellation,
              findById: () =>
                Effect.succeed({
                  id,
                  dotyposReservationId: "dotypos-awaiting-delivery",
                  fulfillmentState: "awaiting_delivery",
                  paymentState: "paid",
                  reservationState: "confirmed",
                  updatedAt: Temporal.Now.instant(),
                } as never),
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.die("details must not be loaded"),
            })
          )
        )
      )
    ),
    Effect.flip,
    Effect.runPromise
  );

  expect(result).toBeInstanceOf(ReservationAdministrationError);
  expect(result).toMatchObject({
    code: "not_cancellable",
    reason: "delivery_in_progress",
    message:
      "The confirmation email is still being delivered. Try again after delivery completes.",
  });
  expect(cancelReservation).not.toHaveBeenCalled();
  expect(claimRequestedCancellation).not.toHaveBeenCalled();
});

test("does not adopt a pre-existing provider cancellation", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationError, ReservationAdministrationService } =
    await import("./reservation-administration.service");
  const { ReservationCancellation } = await import(
    "@/features/reservation/backend/reservation-cancellation.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-provider-cancelled"
  );
  const claimRequestedCancellation = mock(() =>
    Effect.die("must not claim")
  );

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: true,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {}),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimRequestedCancellation,
              findById: () =>
                Effect.succeed({
                  id,
                  dotyposReservationId: "dotypos-provider-cancelled",
                  fulfillmentState: "fulfilled",
                  paymentState: "paid",
                  reservationState: "confirmed",
                  updatedAt: Temporal.Now.instant(),
                } as never),
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () =>
                Effect.succeed({
                  id,
                  dotyposReservationId: "dotypos-provider-cancelled",
                  providerStatus: "CANCELLED",
                } as never),
            })
          )
        )
      )
    ),
    Effect.flip,
    Effect.runPromise
  );

  expect(result).toBeInstanceOf(ReservationAdministrationError);
  expect(result).toMatchObject({
    code: "not_cancellable",
    reason: "cancelled_in_dotypos",
  });
  expect(claimRequestedCancellation).not.toHaveBeenCalled();
});

test("resumes a stale cancellation after an interrupted request", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const { ReservationCancellation } = await import(
    "@/features/reservation/backend/reservation-cancellation.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-interrupted"
  );
  const current = {
    id,
    dotyposReservationId: "dotypos-interrupted",
    fulfillmentState: "fulfilled",
    reservationState: "cancelling",
    updatedAt: Temporal.Now.instant().subtract({ minutes: 2 }),
  } as never;
  const details = {
    id,
    dotyposReservationId: "dotypos-interrupted",
    providerStatus: "CANCELLED",
  } as never;
  const claimRequestedCancellation = mock(() => Effect.succeed(current));
  const completeRequestedCancellation = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {
              cancelReservation: () => Effect.die("already cancelled"),
            }),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimRequestedCancellation,
              findById: () => Effect.succeed(current),
              markRequestedCancellationFailed: () => Effect.void,
              completeRequestedCancellation,
            }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: () => Effect.succeed(details),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({ outcome: "cancelled", email: "not_requested" });
  expect(claimRequestedCancellation).toHaveBeenCalledWith({
    id,
    cause: "operator",
    staleCancellingBefore: expect.any(Temporal.Instant),
  });
  expect(completeRequestedCancellation).toHaveBeenCalledWith({
    id,
    cancelledAt: expect.any(Temporal.Instant),
    claimedAt: current.updatedAt,
    failureCode: null,
  });
});

test("reconciles a duplicate provider failure after another worker cancelled", async () => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const { ReservationCancellation } = await import(
    "@/features/reservation/backend/reservation-cancellation.service"
  );
  const id = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-provider-race"
  );
  const current = {
    id,
    dotyposReservationId: "dotypos-provider-race",
    fulfillmentState: "fulfilled",
    paymentState: "paid",
    reservationState: "cancelling",
    updatedAt: Temporal.Now.instant().subtract({ minutes: 2 }),
  } as never;
  const confirmed = {
    id,
    dotyposReservationId: "dotypos-provider-race",
    providerStatus: "CONFIRMED",
  } as never;
  const cancelled = { ...confirmed, providerStatus: "CANCELLED" } as never;
  const getReservation = mock(() =>
    Effect.succeed(
      getReservation.mock.calls.length === 1 ? confirmed : cancelled
    )
  );
  const markRequestedCancellationFailed = mock(() => Effect.void);
  const completeRequestedCancellation = mock(() => Effect.void);

  const result = await Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      reservationId: id,
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, {
              cancelReservation: () =>
                Effect.fail("already cancelled" as never),
            }),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimRequestedCancellation: () => Effect.succeed(current),
              findById: () => Effect.succeed(current),
              markRequestedCancellationFailed,
              completeRequestedCancellation,
            }),
            Layer.mock(WorkspaceReservationService, { getReservation })
          )
        )
      )
    ),
    Effect.runPromise
  );

  expect(result).toEqual({ outcome: "cancelled", email: "not_requested" });
  expect(getReservation).toHaveBeenCalledTimes(2);
  expect(markRequestedCancellationFailed).not.toHaveBeenCalled();
  expect(completeRequestedCancellation).toHaveBeenCalledTimes(1);
});

const cancelWith = async ({
  current,
  details = { providerStatus: "CONFIRMED" },
  findById = () => Effect.succeed(current),
  getReservation = () =>
    Effect.succeed({
      id: "reservation-refusal",
      dotyposReservationId: "dotypos-refusal",
      ...details,
    }),
  claimRequestedCancellation = () => Effect.succeed(current),
  cancelReservation = () => Effect.void,
  completeRequestedCancellation = () => Effect.void,
  markRequestedCancellationFailed = () => Effect.void,
  force,
}: {
  readonly current: Partial<WorkspaceReservation> | null;
  readonly details?: Partial<WorkspaceReservationDetails>;
  readonly findById?: () => Effect.Effect<unknown, unknown>;
  readonly getReservation?: () => Effect.Effect<unknown, unknown>;
  readonly claimRequestedCancellation?: () => Effect.Effect<
    unknown,
    unknown
  >;
  readonly cancelReservation?: () => Effect.Effect<void, unknown>;
  readonly completeRequestedCancellation?: () => Effect.Effect<void, unknown>;
  readonly markRequestedCancellationFailed?: () => Effect.Effect<
    void,
    unknown
  >;
  readonly force?: boolean;
}) => {
  const { WorkspaceReservationEmailService } = await import(
    "@/features/checkout/backend/fulfillment/workspace-reservation-email.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { WorkspaceReservationService } = await import(
    "@/features/reservation/backend/workspace-reservation.service"
  );
  const { ReservationAdministrationService } = await import(
    "./reservation-administration.service"
  );
  const { ReservationCancellation } = await import(
    "@/features/reservation/backend/reservation-cancellation.service"
  );
  return Effect.gen(function* () {
    const service = yield* ReservationAdministrationService;
    return yield* service.cancel({
      ...(force !== undefined && { force }),
      reservationId: workspaceReservationIdSchema.make("reservation-refusal"),
      sendCancellationEmail: false,
    });
  }).pipe(
    Effect.provide(
      ReservationAdministrationService.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(DotyposService, { cancelReservation } as never),
            Layer.mock(WorkspaceReservationEmailService, {}),
            Layer.mock(WorkspaceReservationRepository, {
              claimRequestedCancellation,
              findById,
              markRequestedCancellationFailed,
              completeRequestedCancellation,
            } as never),
            Layer.mock(WorkspaceReservationService, {
              getReservation,
            } as never)
          )
        )
      )
    ),
    Effect.flip,
    Effect.runPromise
  );
};

const cancellableReservation = {
  id: workspaceReservationIdSchema.make("reservation-refusal"),
  dotyposReservationId: "dotypos-refusal",
  fulfillmentState: "fulfilled",
  paymentState: "paid",
  reservationState: "confirmed",
  failureCode: null,
  activePaymentAttemptId: null,
  updatedAt: Temporal.Instant.from("2026-08-10T10:00:00Z"),
} satisfies Partial<WorkspaceReservation>;

test("explains each refusal before claiming the reservation", async () => {
  const claimRequestedCancellation = mock(() => Effect.die("no claim"));
  const refusal = async (
    input: Omit<
      Parameters<typeof cancelWith>[0],
      "claimRequestedCancellation"
    >
  ) => {
    const error = await cancelWith({
      ...input,
      claimRequestedCancellation,
    });
    return { code: error.code, reason: error.reason };
  };

  expect(
    await Promise.all([
      refusal({ current: null }),
      refusal({ current: null, findById: () => Effect.fail("database down") }),
      refusal({
        current: { ...cancellableReservation, fulfillmentState: "processing" },
      }),
      refusal({
        current: { ...cancellableReservation, reservationState: "draft" },
      }),
      refusal({
        current: cancellableReservation,
        getReservation: () => Effect.fail("Dotypos down"),
      }),
      refusal({
        current: { ...cancellableReservation, paymentState: "pending" },
        force: true,
      }),
    ])
  ).toEqual([
    { code: "not_found", reason: "not_found" },
    { code: "cancellation_failed", reason: "reservation_unavailable" },
    { code: "not_cancellable", reason: "confirmation_in_progress" },
    { code: "not_cancellable", reason: "invalid_state" },
    { code: "cancellation_failed", reason: "details_unavailable" },
    { code: "not_cancellable", reason: "pending_payment" },
  ]);
  expect(claimRequestedCancellation).not.toHaveBeenCalled();
});

test("stops without cancelling in Dotypos when the claim fails or loses a race", async () => {
  const cancelReservation = mock(() => Effect.void);

  const failed = await cancelWith({
    current: cancellableReservation,
    claimRequestedCancellation: () => Effect.fail("lock timeout"),
    cancelReservation,
  });
  const changed = await cancelWith({
    current: cancellableReservation,
    claimRequestedCancellation: () => Effect.succeed(null),
    cancelReservation,
  });

  expect(failed).toMatchObject({
    code: "cancellation_failed",
    reason: "claim_failed",
    cause: "lock timeout",
  });
  expect(changed).toMatchObject({ code: "not_cancellable", reason: "changed" });
  expect(cancelReservation).not.toHaveBeenCalled();
});

test("marks the claim failed when Dotypos or the local record fails", async () => {
  const completeRequestedCancellation = mock(() => Effect.void);
  const markRequestedCancellationFailed = mock(() => Effect.void);

  const dotyposFailed = await cancelWith({
    current: cancellableReservation,
    cancelReservation: () => Effect.fail("Dotypos refused"),
    getReservation: mock()
      .mockReturnValueOnce(
        Effect.succeed({
          dotyposReservationId: "dotypos-refusal",
          providerStatus: "CONFIRMED",
        })
      )
      .mockReturnValueOnce(Effect.fail("Dotypos down")),
    completeRequestedCancellation,
    markRequestedCancellationFailed,
  });
  expect(dotyposFailed).toMatchObject({
    code: "cancellation_failed",
    reason: "dotypos_failed",
    cause: "Dotypos refused",
  });
  expect(completeRequestedCancellation).not.toHaveBeenCalled();
  expect(markRequestedCancellationFailed).toHaveBeenLastCalledWith({
    id: cancellableReservation.id,
    claimedAt: cancellableReservation.updatedAt,
    failureCode: "admin_dotypos_cancel_failed",
  });

  const recordFailed = await cancelWith({
    current: {
      ...cancellableReservation,
      failureCode: "admin_forced_payment_cancellation",
    },
    completeRequestedCancellation: () => Effect.fail("write conflict"),
    markRequestedCancellationFailed,
  });
  expect(recordFailed).toMatchObject({
    code: "cancellation_failed",
    reason: "record_failed",
    cause: "write conflict",
  });
  expect(markRequestedCancellationFailed).toHaveBeenLastCalledWith({
    id: cancellableReservation.id,
    claimedAt: cancellableReservation.updatedAt,
    failureCode: "admin_forced_payment_cancellation",
  });

  await cancelWith({
    current: cancellableReservation,
    completeRequestedCancellation: () => Effect.fail("write conflict"),
    markRequestedCancellationFailed,
  });
  expect(markRequestedCancellationFailed).toHaveBeenLastCalledWith({
    id: cancellableReservation.id,
    claimedAt: cancellableReservation.updatedAt,
    failureCode: "admin_local_cancel_failed",
  });
});
