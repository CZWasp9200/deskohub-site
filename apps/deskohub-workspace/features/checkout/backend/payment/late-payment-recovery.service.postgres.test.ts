import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  latePaymentRecoveries,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  holdPostgresTransaction,
  waitForAdvisoryLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import { UnpaidHoldRelease } from "../holds/unpaid-hold-release.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { WorkspaceTableAssignmentService } from "../reservation/workspace-table-assignment.service";
import { LatePaymentRecoveryService } from "./late-payment-recovery.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

/** A collaborator the superseded-payment path must never reach. */
const unreachable = (name: string) =>
  mock(() => Effect.die(`${name} must not be called`));

describe.skipIf(!testDatabase)(
  "LatePaymentRecoveryService.recover on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from late_payment_recoveries where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "update workspace_reservations set active_payment_attempt_id = null where id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const dotypos = {
      getReservationStatus: unreachable("getReservationStatus"),
      cancelReservation: unreachable("cancelReservation"),
      createReservation: unreachable("createReservation"),
      listActiveReservationsOverlapping: unreachable(
        "listActiveReservationsOverlapping"
      ),
    };

    const repositories = Layer.mergeAll(
      LatePaymentRecoveryRepository.Default,
      WorkspaceReservationRepository.Default
    ).pipe(Layer.provide(testDatabase.layer));

    const recoveryLayer = LatePaymentRecoveryService.Default.pipe(
      Layer.provide(UnpaidHoldRelease.Default),
      Layer.provideMerge(
        Layer.mergeAll(
          repositories,
          WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase.pool),
          Layer.mock(DotyposService, dotypos as never),
          Layer.mock(AccountingDocumentSnapshots, {
            find: unreachable("snapshots.find"),
          }),
          Layer.mock(WorkspaceAvailabilityService, {
            ensureAvailable: unreachable("ensureAvailable"),
          }),
          Layer.mock(WorkspaceTableAssignmentService, {
            assignTableId: unreachable("assignTableId"),
          }),
          Layer.mock(ReservationFulfillment, {
            run: unreachable("fulfillment.run"),
          })
        )
      )
    );

    const recover = (paymentAttemptId: string) =>
      LatePaymentRecoveryService.pipe(
        Effect.flatMap((service) =>
          service.recover({
            paymentAttemptId: paymentAttemptIdSchema.make(paymentAttemptId),
          })
        ),
        Effect.provide(recoveryLayer),
        Effect.runPromise
      );

    /**
     * An order whose first payment page (attempt A) expired and a newer
     * attempt (B) now holds the live hold and a pending payment, as after a
     * retry. A's payment arrives late and its recovery has started.
     */
    const insertRetriedOrderWithLatePayment = async () => {
      const id = crypto.randomUUID();
      const reservation = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "held", payment: "pending" },
          overrides: {
            reservationHoldExpiresAt: Temporal.Now.instant().add({
              minutes: 30,
            }),
          },
        })
      );
      reservationIds.push(reservation.id);
      const earlier = paymentAttemptIdSchema.make(`earlier-${id}`);
      const newer = paymentAttemptIdSchema.make(`newer-${id}`);
      await Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values([
          {
            id: earlier,
            workspaceReservationId: reservation.id,
            provider: "nexi",
            providerOrderId: NexiOrderIdSchema.make(`order-earlier-${id}`),
            state: "expired",
            failureCode: "payment_abandoned_after_provider_cutoff",
            amountValue: 29_000,
            amountExponent: 2,
            currency: "CZK",
          },
          {
            id: newer,
            workspaceReservationId: reservation.id,
            provider: "nexi",
            providerOrderId: NexiOrderIdSchema.make(`order-newer-${id}`),
            state: "pending",
            amountValue: 29_000,
            amountExponent: 2,
            currency: "CZK",
          },
        ])
      );
      await Effect.runPromise(
        testDatabase.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: newer })
          .where(eq(workspaceReservations.id, reservation.id))
      );
      await Effect.runPromise(
        LatePaymentRecoveryRepository.pipe(
          Effect.flatMap((recoveries) =>
            recoveries.start({
              paymentAttemptId: earlier,
              workspaceReservationId: reservation.id,
              providerStatus: "EXECUTED",
              verifiedPaidAt: Temporal.Now.instant(),
            })
          ),
          Effect.provide(repositories)
        )
      );
      const [before] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, reservation.id))
      );
      return { reservationId: reservation.id, earlier, newer, before: before! };
    };

    const readOrder = async (input: {
      readonly reservationId: WorkspaceReservationId;
      readonly earlier: string;
      readonly newer: string;
    }) => {
      const read = <T>(query: Effect.Effect<T, unknown>) =>
        Effect.runPromise(query);
      const [reservation] = await read(
        testDatabase.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.reservationId))
      );
      const attempts = await read(
        testDatabase.db
          .select()
          .from(paymentAttempts)
          .where(
            eq(paymentAttempts.workspaceReservationId, input.reservationId)
          )
      );
      const [recovery] = await read(
        testDatabase.db
          .select()
          .from(latePaymentRecoveries)
          .where(
            eq(
              latePaymentRecoveries.workspaceReservationId,
              input.reservationId
            )
          )
      );
      return {
        reservation: reservation!,
        earlier: attempts.find(({ id }) => id === input.earlier)!,
        newer: attempts.find(({ id }) => id === input.newer)!,
        recovery: recovery!,
      };
    };

    test("refunds a payment on an earlier page without touching the newer attempt or its hold", async () => {
      const order = await insertRetriedOrderWithLatePayment();

      expect(await recover(order.earlier)).toBe("refund_required");

      const after = await readOrder(order);
      expect(after.earlier).toMatchObject({
        state: "paid",
        refundState: "required",
      });
      expect(after.newer).toMatchObject({ state: "pending" });
      expect(after.recovery).toMatchObject({
        state: "refund_required",
        failureCode: "late_payment_superseded_attempt",
      });
      expect(after.reservation).toMatchObject({
        reservationState: "held",
        paymentState: "pending",
        activePaymentAttemptId: order.newer,
        dotyposReservationId: order.before.dotyposReservationId,
      });
      expect(
        after.reservation.reservationHoldExpiresAt?.equals(
          order.before.reservationHoldExpiresAt!
        )
      ).toBe(true);
      for (const call of Object.values(dotypos)) {
        expect(call).not.toHaveBeenCalled();
      }
    });

    test("waits for the order's lock section before it claims the recovery", async () => {
      const order = await insertRetriedOrderWithLatePayment();
      const orderLock = ["reservation-order", order.reservationId] as const;
      // Another workflow, such as hold cleanup, holds the order's section.
      const holder = await holdPostgresTransaction(
        testDatabase.pool,
        "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        orderLock
      );
      let recovering: Promise<unknown> | undefined;
      try {
        recovering = recover(order.earlier);
        await waitForAdvisoryLockWaiter(testDatabase.pool, orderLock);
        expect((await readOrder(order)).recovery.state).toBe("pending");
      } finally {
        await holder.commit();
      }

      expect(await recovering).toBe("refund_required");
      expect((await readOrder(order)).recovery.state).toBe("refund_required");
    });
  }
);
