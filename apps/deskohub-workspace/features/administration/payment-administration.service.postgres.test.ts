import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { NetworkError, NexiOrderIdSchema } from "@deskohub/nexi";
import { NexiServiceMock } from "@deskohub/nexi/backend/service.mock";
import { Effect, Layer } from "effect";
import { orders, paymentAttempts } from "@/db/schema";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import type { OrderId } from "@/features/order";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { PaymentAdministrationService } from "./payment-administration.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "PaymentAdministrationService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const runId = crypto.randomUUID();
    const reservationId = workspaceReservationIdSchema.make(
      `payment-admin-${runId}`
    );

    const purchaseOrderIds: OrderId[] = [];

    beforeAll(async () => {
      await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "confirmed", payment: "paid" },
          overrides: { id: reservationId },
        })
      );
    });

    afterAll(async () => {
      await testDatabase.pool.query("delete from orders where id = any($1)", [
        purchaseOrderIds,
      ]);
      // Payment attempts cascade with their reservation.
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = $1",
        [reservationId]
      );
    });

    const insertOrder = (
      label: string,
      times: {
        readonly attemptCreatedAt: string;
        readonly providerOrderCreatedAt: string | null;
      },
      orderId?: OrderId
    ) => {
      const providerOrderId = NexiOrderIdSchema.make(`${label}-${runId}`);
      return Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values({
          id: paymentAttemptIdSchema.make(`attempt-${label}-${runId}`),
          ...(orderId === undefined
            ? { workspaceReservationId: reservationId }
            : { orderId }),
          provider: "nexi",
          providerOrderId,
          state: "paid",
          amountValue: 5000,
          amountExponent: 2,
          currency: "CZK",
          createdAt: Temporal.Instant.from(times.attemptCreatedAt),
          providerOrderCreatedAt:
            times.providerOrderCreatedAt === null
              ? null
              : Temporal.Instant.from(times.providerOrderCreatedAt),
        })
      ).then(() => providerOrderId);
    };

    test("filters local orders by provider order creation time, falling back to attempt creation", async () => {
      // The window is far in the past so other suites' orders stay outside it.
      const providerTimeInside = await insertOrder("provider-time-inside", {
        attemptCreatedAt: "2001-09-01T10:00:00Z",
        providerOrderCreatedAt: "2001-08-05T10:00:00Z",
      });
      const attemptTimeFallback = await insertOrder("attempt-time-fallback", {
        attemptCreatedAt: "2001-08-04T10:00:00Z",
        providerOrderCreatedAt: null,
      });
      await insertOrder("provider-time-before", {
        attemptCreatedAt: "2001-08-03T10:00:00Z",
        providerOrderCreatedAt: "2001-07-20T10:00:00Z",
      });
      await insertOrder("provider-time-after", {
        attemptCreatedAt: "2001-08-03T11:00:00Z",
        providerOrderCreatedAt: "2001-08-07T00:00:00Z",
      });

      const result = await Effect.gen(function* () {
        const administration = yield* PaymentAdministrationService;
        return yield* administration.listOrders({
          fromTime: "2001-08-01T00:00:00Z",
          toTime: "2001-08-07T00:00:00Z",
        });
      }).pipe(
        Effect.provide(
          PaymentAdministrationService.Default.pipe(
            Layer.provide(
              Layer.merge(
                testDatabase.layer,
                NexiServiceMock({ listOrders: () => Effect.succeed([]) })
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result.items.map(({ orderId }) => orderId).sort()).toEqual(
        [providerTimeInside, attemptTimeFallback].sort()
      );
    });

    test("keeps a reservation payment visible when a newer pass attempt has no reservation and Nexi is unavailable", async () => {
      const reservationOrder = await insertOrder("reservation-in-window", {
        attemptCreatedAt: "2001-09-04T10:00:00Z",
        providerOrderCreatedAt: null,
      });

      const passOrder = await Effect.runPromise(
        testDatabase.db
          .insert(orders)
          .values({
            kind: "pass-purchase",
            dotyposCustomerId: DotyposCustomerIdSchema.make(
              "synthetic-pass-buyer"
            ),
            paymentState: "pending",
            fulfillmentState: "not_started",
          })
          .returning({ id: orders.id })
      );
      const passOrderId = passOrder[0]?.id;
      if (!passOrderId) throw new Error("Pass order was not created");
      purchaseOrderIds.push(passOrderId);
      await insertOrder(
        "unlinked-pass-in-window",
        {
          attemptCreatedAt: "2001-09-05T10:00:00Z",
          providerOrderCreatedAt: null,
        },
        passOrderId
      );

      const result = await Effect.gen(function* () {
        const administration = yield* PaymentAdministrationService;
        return yield* administration.listOrders({
          fromTime: "2001-09-03T00:00:00Z",
          toTime: "2001-09-07T00:00:00Z",
          maxRecords: 1,
        });
      }).pipe(
        Effect.provide(
          PaymentAdministrationService.Default.pipe(
            Layer.provide(
              Layer.merge(
                testDatabase.layer,
                NexiServiceMock({
                  listOrders: () =>
                    Effect.fail(
                      new NetworkError({ message: "Nexi timed out" })
                    ),
                })
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result).toMatchObject({
        providerAvailable: false,
        items: [{ orderId: reservationOrder, link: { reservationId } }],
      });
    });
  }
);
