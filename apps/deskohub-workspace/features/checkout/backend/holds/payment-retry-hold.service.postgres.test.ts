import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type DotyposReservationId,
  DotyposReservationIdSchema,
  type DotyposReservationStatus,
  DotyposService,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  latePaymentRecoveries,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  WorkspaceAvailabilityService,
  WorkspaceTableUnavailableError,
} from "@/features/reservation/backend/workspace-availability.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentAttemptRepository } from "../repositories/payment-attempt.repository";
import { rebuildAcceptedReservation } from "../reservation/order-dotypos-reservation";
import { WorkspaceTableAssignmentService } from "../reservation/workspace-table-assignment.service";
import { PaymentRetryHoldService } from "./payment-retry-hold.service";
import { ReservationHoldCleanupScheduleService } from "./reservation-hold-cleanup-queue.service";
import { UnpaidHoldRelease } from "./unpaid-hold-release.service";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

/** The accepted cowork reservation its last attempt priced, as a retry books it. */
const recreated = (() => {
  const rebuilt = rebuildAcceptedReservation(
    {
      reservationDetails: { kind: "cowork", entryTier: "basic", coffee: true },
    } as WorkspaceReservation,
    makeCoworkInvoiceDocument("en-US") as never,
    undefined
  );
  if (!rebuilt) throw new Error("The cowork reservation must rebuild.");
  return rebuilt;
})();

const createdDotyposId = DotyposReservationIdSchema.make("dotypos-created");

describe.skipIf(!postgresDatabase)(
  "PaymentRetryHoldService.secure on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    const created: WorkspaceReservationId[] = [];

    afterEach(async () => {
      if (created.length === 0) return;
      await postgres.db
        .update(workspaceReservations)
        .set({ activePaymentAttemptId: null })
        .where(inArray(workspaceReservations.id, created))
        .pipe(Effect.runPromise);
      await postgres.db
        .delete(latePaymentRecoveries)
        .where(inArray(latePaymentRecoveries.workspaceReservationId, created))
        .pipe(Effect.runPromise);
      await postgres.db
        .delete(paymentAttempts)
        .where(inArray(paymentAttempts.workspaceReservationId, created))
        .pipe(Effect.runPromise);
      await postgres.db
        .delete(workspaceReservations)
        .where(inArray(workspaceReservations.id, created))
        .pipe(Effect.runPromise);
      created.length = 0;
    });

    /**
     * An order whose payment `paymentState` ended on its active attempt, with
     * the local reservation columns `overrides` names.
     */
    const retriedOrder = async (input: {
      readonly reservation: "held" | "cancelled" | "hold_expired";
      readonly overrides?: Partial<typeof workspaceReservations.$inferInsert>;
    }) => {
      const row = await workspaceFixtures(postgres.db)
        .reservation({ stage: { reservation: input.reservation } })
        .pipe(Effect.runPromise);
      created.push(row.id);
      const attemptId = `attempt-${crypto.randomUUID()}` as PaymentAttemptId;
      await postgres.db
        .insert(paymentAttempts)
        .values({
          id: attemptId,
          workspaceReservationId: row.id,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(
            `order-${crypto.randomUUID()}`
          ),
          state: "failed",
          failureCode: "nexi_payment_failed",
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
        })
        .pipe(Effect.runPromise);
      await postgres.db
        .update(workspaceReservations)
        .set({
          activePaymentAttemptId: attemptId,
          paymentState: "failed",
          failureCode: "nexi_payment_failed",
          ...input.overrides,
        })
        .where(eq(workspaceReservations.id, row.id))
        .pipe(Effect.runPromise);
      return { orderId: row.id, attemptId };
    };

    const rowOf = async (id: WorkspaceReservationId) => {
      const [row] = await postgres.db
        .select()
        .from(workspaceReservations)
        .where(eq(workspaceReservations.id, id))
        .pipe(Effect.runPromise);
      return row!;
    };

    const makeHarness = (
      options: {
        readonly status?: DotyposReservationStatus;
        readonly overlapping?: readonly unknown[];
        readonly unavailable?: boolean;
        /** Runs when the retry creates the new Dotypos reservation. */
        readonly onCreate?: () => Promise<void>;
      } = {}
    ) => {
      const spies = {
        getReservationStatus: mock((_id: DotyposReservationId) =>
          Effect.succeed<DotyposReservationStatus>(options.status ?? "NEW")
        ),
        cancelReservation: mock((_id: DotyposReservationId) => Effect.void),
        listActiveReservationsOverlapping: mock(() =>
          Effect.succeed((options.overlapping ?? []) as never)
        ),
        createReservation: mock((_input: { readonly status: string }) =>
          Effect.promise(async () => {
            await options.onCreate?.();
            return { id: createdDotyposId } as never;
          })
        ),
        ensureAvailable: mock(() =>
          options.unavailable
            ? Effect.fail(new WorkspaceTableUnavailableError({} as never))
            : Effect.void
        ),
        enqueueCleanup: mock(() => Effect.void),
      };
      const reservations = WorkspaceReservationRepository.Default.pipe(
        Layer.provide(postgres.layer)
      );
      const dotypos = Layer.mock(DotyposService, {
        getReservationStatus: spies.getReservationStatus as never,
        cancelReservation: spies.cancelReservation as never,
        listActiveReservationsOverlapping:
          spies.listActiveReservationsOverlapping as never,
        createReservation: spies.createReservation as never,
      });
      const layer = PaymentRetryHoldService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            reservations,
            LatePaymentRecoveryRepository.Default.pipe(
              Layer.provide(postgres.layer)
            ),
            PaymentAttemptRepository.Default.pipe(
              Layer.provide(postgres.layer)
            ),
            UnpaidHoldRelease.Default.pipe(
              Layer.provide(Layer.mergeAll(reservations, dotypos))
            ),
            dotypos,
            Layer.mock(WorkspaceAvailabilityService, {
              ensureAvailable: spies.ensureAvailable as never,
            }),
            Layer.mock(WorkspaceTableAssignmentService, {
              assignTableId: (() => Effect.succeed("table-id")) as never,
            }),
            Layer.mock(ReservationHoldCleanupScheduleService, {
              enqueueCleanup: spies.enqueueCleanup as never,
            }),
            WorkspaceDatabaseAdvisoryLock.makeLayer(postgres.pool)
          )
        )
      );
      const secure = (order: {
        readonly orderId: WorkspaceReservationId;
        readonly attemptId: PaymentAttemptId;
      }) =>
        PaymentRetryHoldService.pipe(
          Effect.flatMap((service) =>
            service.secure({
              orderId: order.orderId,
              retriedAttemptId: order.attemptId,
              recreated,
            })
          ),
          Effect.provide(layer),
          Effect.runPromise
        );
      return { spies, secure };
    };

    test("keeps a live hold, and clears the retried attempt so its late payment can only be refunded", async () => {
      const order = await retriedOrder({
        reservation: "held",
        overrides: {
          reservationHoldExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
        },
      });
      const before = await rowOf(order.orderId);
      const harness = makeHarness();

      const result = await harness.secure(order);

      expect(result.kind).toBe("kept");
      const after = await rowOf(order.orderId);
      expect(after.activePaymentAttemptId).toBeNull();
      expect(after.dotyposReservationId).toBe(before.dotyposReservationId);
      expect(after.reservationState).toBe("held");
      expect(harness.spies.cancelReservation).not.toHaveBeenCalled();
      expect(harness.spies.createReservation).not.toHaveBeenCalled();
    });

    test("releases an expired hold and books the same reservation again for the same order", async () => {
      const order = await retriedOrder({
        reservation: "held",
        overrides: {
          reservationHoldExpiresAt: Temporal.Now.instant().subtract({
            minutes: 1,
          }),
        },
      });
      const before = await rowOf(order.orderId);
      const harness = makeHarness();

      const result = await harness.secure(order);

      expect(result.kind).toBe("reacquired");
      expect(harness.spies.cancelReservation).toHaveBeenCalledWith(
        before.dotyposReservationId
      );
      expect(harness.spies.ensureAvailable).toHaveBeenCalledTimes(1);
      expect(harness.spies.createReservation).toHaveBeenCalledTimes(1);
      expect(harness.spies.createReservation.mock.calls[0]?.[0]).toMatchObject({
        status: "NEW",
      });
      const after = await rowOf(order.orderId);
      expect(after).toMatchObject({
        id: order.orderId,
        reservationState: "held",
        dotyposReservationId: createdDotyposId,
        activePaymentAttemptId: null,
        cancellationCause: null,
        reservationCancelledAt: null,
        paymentState: "failed",
      });
      expect(
        Temporal.Instant.compare(
          after.reservationHoldExpiresAt!,
          Temporal.Now.instant()
        )
      ).toBe(1);
      expect(harness.spies.enqueueCleanup).toHaveBeenCalledTimes(1);
    });

    test("books again a hold that hold cleanup already released", async () => {
      const order = await retriedOrder({
        reservation: "cancelled",
        overrides: { cancellationCause: "hold_expired" },
      });
      const harness = makeHarness();

      const result = await harness.secure(order);

      expect(result.kind).toBe("reacquired");
      expect(harness.spies.cancelReservation).not.toHaveBeenCalled();
      expect((await rowOf(order.orderId)).reservationState).toBe("held");
    });

    test("keeps the same hold when a prepared retry is prepared again", async () => {
      const order = await retriedOrder({
        reservation: "held",
        overrides: {
          reservationHoldExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
        },
      });
      const before = await rowOf(order.orderId);
      const harness = makeHarness();

      await harness.secure(order);
      const again = await harness.secure(order);

      expect(again.kind).toBe("kept");
      expect((await rowOf(order.orderId)).dotyposReservationId).toBe(
        before.dotyposReservationId
      );
      expect(harness.spies.createReservation).not.toHaveBeenCalled();
    });

    test("books again a prepared retry whose hold then lapsed", async () => {
      const order = await retriedOrder({
        reservation: "cancelled",
        overrides: {
          activePaymentAttemptId: null,
          cancellationCause: "hold_expired",
        },
      });
      const harness = makeHarness();

      const result = await harness.secure(order);

      expect(result.kind).toBe("reacquired");
      expect((await rowOf(order.orderId)).reservationState).toBe("held");
    });

    test("never secures a retry of an attempt a newer one replaced", async () => {
      const order = await retriedOrder({
        reservation: "held",
        overrides: {
          activePaymentAttemptId: null,
          reservationHoldExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
        },
      });
      await postgres.db
        .insert(paymentAttempts)
        .values({
          id: `attempt-${crypto.randomUUID()}` as PaymentAttemptId,
          workspaceReservationId: order.orderId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(
            `order-${crypto.randomUUID()}`
          ),
          state: "failed",
          failureCode: "nexi_payment_failed",
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
          createdAt: Temporal.Now.instant().add({ minutes: 1 }),
        })
        .pipe(Effect.runPromise);
      const harness = makeHarness();

      const result = await harness.secure(order);

      expect(result).toEqual({ kind: "refused", reason: "not_retryable" });
      expect(harness.spies.getReservationStatus).not.toHaveBeenCalled();
    });

    test.each([
      ["an operator's cancellation", "operator" as const],
      ["a superseded checkout", "checkout_superseded" as const],
      ["a cancellation of unknown origin", null],
    ])("never books again %s", async (_name, cancellationCause) => {
      const order = await retriedOrder({
        reservation: "cancelled",
        overrides: { cancellationCause },
      });
      const harness = makeHarness();

      const result = await harness.secure(order);

      expect(result).toEqual({ kind: "refused", reason: "not_retryable" });
      expect(harness.spies.createReservation).not.toHaveBeenCalled();
      expect((await rowOf(order.orderId)).reservationState).toBe("cancelled");
    });

    test("refuses while a late payment of the order is being recovered", async () => {
      const order = await retriedOrder({
        reservation: "cancelled",
        overrides: { cancellationCause: "hold_expired" },
      });
      await postgres.db
        .insert(latePaymentRecoveries)
        .values({
          paymentAttemptId: order.attemptId,
          workspaceReservationId: order.orderId,
          state: "pending",
          originalDotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-original-${crypto.randomUUID()}`
          ),
          verifiedPaidAt: Temporal.Now.instant(),
        })
        .pipe(Effect.runPromise);
      const harness = makeHarness();

      const result = await harness.secure(order);

      expect(result).toEqual({ kind: "refused", reason: "not_retryable" });
      expect(harness.spies.createReservation).not.toHaveBeenCalled();
    });

    test("says the spot is gone and leaves the order cancelled when no table is free", async () => {
      const order = await retriedOrder({
        reservation: "cancelled",
        overrides: { cancellationCause: "hold_expired" },
      });
      const harness = makeHarness({ unavailable: true });

      const result = await harness.secure(order);

      expect(result).toEqual({ kind: "spot_unavailable" });
      expect(harness.spies.createReservation).not.toHaveBeenCalled();
      expect((await rowOf(order.orderId)).reservationState).toBe("cancelled");
    });

    test("leaves an expired hold Dotypos no longer holds as NEW to an operator", async () => {
      const order = await retriedOrder({
        reservation: "held",
        overrides: {
          reservationHoldExpiresAt: Temporal.Now.instant().subtract({
            minutes: 1,
          }),
        },
      });
      const harness = makeHarness({ status: "CONFIRMED" });

      const result = await harness.secure(order);

      expect(result).toEqual({ kind: "refused", reason: "release_refused" });
      expect(harness.spies.cancelReservation).not.toHaveBeenCalled();
      expect(harness.spies.createReservation).not.toHaveBeenCalled();
    });

    test("takes over the one NEW reservation an interrupted earlier retry created", async () => {
      const order = await retriedOrder({
        reservation: "cancelled",
        overrides: { cancellationCause: "payment_retry" },
      });
      const orphan = DotyposReservationIdSchema.make("dotypos-orphan");
      const harness = makeHarness({
        overlapping: [
          {
            id: orphan,
            status: "NEW",
            note: `Platební objednávka: ${order.orderId}`,
          },
        ],
      });

      const result = await harness.secure(order);

      expect(result.kind).toBe("reacquired");
      expect(harness.spies.createReservation).not.toHaveBeenCalled();
      expect((await rowOf(order.orderId)).dotyposReservationId).toBe(orphan);
    });

    test("cancels the reservation it created when the order changed before it could be attached", async () => {
      const order = await retriedOrder({
        reservation: "cancelled",
        overrides: { cancellationCause: "hold_expired" },
      });
      const harness = makeHarness({
        onCreate: () =>
          postgres.db
            .update(workspaceReservations)
            .set({ cancellationCause: "operator" })
            .where(eq(workspaceReservations.id, order.orderId))
            .pipe(Effect.runPromise)
            .then(() => {}),
      });

      const result = await harness.secure(order);

      expect(result).toEqual({ kind: "refused", reason: "changed" });
      expect(harness.spies.cancelReservation).toHaveBeenCalledWith(
        createdDotyposId
      );
      expect((await rowOf(order.orderId)).reservationState).toBe("cancelled");
    });

    test("books one Dotypos reservation when the same retry is secured twice at once", async () => {
      const order = await retriedOrder({
        reservation: "cancelled",
        overrides: { cancellationCause: "hold_expired" },
      });
      // Booking takes long enough for the second call to arrive meanwhile.
      const harness = makeHarness({ onCreate: () => Bun.sleep(300) });

      const results = await Promise.all([
        harness.secure(order),
        harness.secure(order),
      ]);

      // The second waits for the first's lock section, then keeps its hold.
      expect(results.map((result) => result.kind).toSorted()).toEqual([
        "kept",
        "reacquired",
      ]);
      expect(harness.spies.createReservation).toHaveBeenCalledTimes(1);
    });
  }
);
