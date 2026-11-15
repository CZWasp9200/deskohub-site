import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  type GetNexiOrderInput,
  NetworkError,
  type NexiOrder,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { paymentAttempts } from "@/db/schema";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { PaymentRefundRepository } from "../repositories/payment-refund.repository";
import { PaymentRefundService } from "./payment-refund.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const refundedOrder = (orderId: GetNexiOrderInput["orderId"]): NexiOrder => ({
  orderId,
  operations: [
    { operationType: "CAPTURE", operationResult: "EXECUTED", amount: "29000" },
    {
      operationType: "REFUND",
      operationResult: "EXECUTED",
      operationTime: "2026-10-05T08:30:00Z",
      amount: "29000",
    },
  ],
});

const unrefundedOrder = (orderId: GetNexiOrderInput["orderId"]): NexiOrder => ({
  orderId,
  operations: [
    { operationType: "CAPTURE", operationResult: "EXECUTED", amount: "29000" },
  ],
});

describe.skipIf(!testDatabase)(
  "PaymentRefundService.reconcileReservationRefunds on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const reconcile = (
      reservationId: WorkspaceReservationId,
      getOrder: NexiService["Service"]["getOrder"]
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PaymentRefundService;
          return yield* service.reconcileReservationRefunds(reservationId);
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ error, attempts: null }),
            onSuccess: (attempts) => ({ error: null, attempts }),
          }),
          Effect.provide(
            PaymentRefundService.Default.pipe(
              Layer.provide(PaymentRefundRepository.Default),
              Layer.provide(
                Layer.merge(
                  Layer.mock(NexiService, { getOrder }),
                  testDatabase.layer
                )
              )
            )
          )
        )
      );

    /** A synthetic cancelled reservation with the given Nexi attempts. */
    const insertReservation = async (
      attempts: readonly {
        readonly refundState: "not_required" | "required";
      }[]
    ) => {
      const { id: reservationId } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "cancelled", payment: "paid" },
        })
      );
      reservationIds.push(reservationId);
      const ids: PaymentAttemptId[] = [];
      for (const [index, attempt] of attempts.entries()) {
        const id = paymentAttemptIdSchema.make(
          `reservation-refund-${crypto.randomUUID()}`
        );
        ids.push(id);
        await Effect.runPromise(
          testDatabase.db.insert(paymentAttempts).values({
            id,
            workspaceReservationId: reservationId,
            provider: "nexi",
            providerOrderId: NexiOrderIdSchema.make(`order-${id}`),
            state: "paid",
            refundState: attempt.refundState,
            createdAt: Temporal.Instant.from("2026-10-01T10:00:00Z").add({
              minutes: index,
            }),
            amountValue: 29_000,
            amountExponent: 2,
            currency: "CZK",
          })
        );
      }
      return { reservationId, attemptIds: ids };
    };

    const readAttempt = async (id: PaymentAttemptId) => {
      const [attempt] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, id))
      );
      return attempt;
    };

    test("records the refund Nexi reports for an attempt awaiting one and returns every attempt", async () => {
      const { reservationId, attemptIds } = await insertReservation([
        { refundState: "not_required" },
        { refundState: "required" },
      ]);
      const getOrder = mock((input: GetNexiOrderInput) =>
        Effect.succeed(refundedOrder(input.orderId))
      );

      const result = await reconcile(reservationId, getOrder);

      expect(result.error).toBeNull();
      expect(getOrder).toHaveBeenCalledTimes(1);
      expect(getOrder.mock.calls[0]?.[0].orderId).toBe(
        NexiOrderIdSchema.make(`order-${attemptIds[1]}`)
      );
      expect(result.attempts).toEqual([
        {
          amountExponent: 2,
          amountValue: 29_000,
          currency: "CZK",
          refundState: "not_required",
          refundedAmountValue: null,
          state: "paid",
        },
        {
          amountExponent: 2,
          amountValue: 29_000,
          currency: "CZK",
          refundState: "refunded",
          refundedAmountValue: 29_000,
          state: "paid",
        },
      ]);
      const refunded = await readAttempt(attemptIds[1] as PaymentAttemptId);
      expect(refunded?.refundedAt).toEqual(
        Temporal.Instant.from("2026-10-05T08:30:00Z")
      );
    });

    test("leaves an attempt awaiting its refund while Nexi reports none", async () => {
      const { reservationId } = await insertReservation([
        { refundState: "required" },
      ]);

      const result = await reconcile(reservationId, (input) =>
        Effect.succeed(unrefundedOrder(input.orderId))
      );

      expect(result.attempts).toEqual([
        expect.objectContaining({
          refundState: "required",
          refundedAmountValue: null,
        }),
      ]);
    });

    test("fails when Nexi can't be read", async () => {
      const { reservationId } = await insertReservation([
        { refundState: "required" },
      ]);

      const result = await reconcile(reservationId, () =>
        Effect.fail(new NetworkError({ message: "synthetic Nexi outage" }))
      );

      expect(result.error?._tag).toBe("PaymentRefundReconciliationError");
    });

    test("reads Nexi only for attempts awaiting a refund", async () => {
      const { reservationId } = await insertReservation([
        { refundState: "not_required" },
      ]);
      const getOrder = mock(() => Effect.die("Nexi must not be read"));

      const result = await reconcile(reservationId, getOrder);

      expect(getOrder).not.toHaveBeenCalled();
      expect(result.attempts).toEqual([
        expect.objectContaining({ refundState: "not_required" }),
      ]);
    });
  }
);
