import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { type EmailDeliveryId, EmailDeliveryIdSchema } from "@deskohub/email";
import { eq } from "drizzle-orm";
import { Cause, Effect, Exit, Layer } from "effect";
import { type FulfillmentState, workspaceReservations } from "@/db/schema";
import { env, getAccountingDocumentSnapshotSecret } from "@/env";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

mock.module("server-only", () => ({}));

// Bun module mocks are process-wide, so pin a non-production deployment,
// where fulfillment completes on the provider's acceptance.
const workspaceEnv = await import("@/env");
mock.module("@/env", () => ({
  ...workspaceEnv,
  env: new Proxy(env, {
    get: (target, key) =>
      key === "VERCEL_ENV" ? undefined : Reflect.get(target, key),
  }),
  getAccountingDocumentSnapshotSecret,
}));

// Services load after the module mocks.
const { DotyposService } = await import("@deskohub/dotypos");
const { CustomerEmailLocaleService, ReservationAuthorDirectory } = await import(
  "@/features/account"
);
const { ReservationInvoiceService } = await import(
  "@/features/accounting/backend/reservation-invoice.service"
);
const { WorkspaceCheckoutAccessCodeService } = await import(
  "@/features/checkout/backend/reservation/access-code.service"
);
const { WorkspaceReservationRepository } = await import(
  "@/features/reservation/backend/workspace-reservation.repository"
);
const { WorkspaceReservationService } = await import(
  "@/features/reservation/backend/workspace-reservation.service"
);
const { recordCheckoutAnalytics } = await import(
  "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
);
const { FulfillmentLedger } = await import("./fulfillment-ledger.repository");
const { PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS, ReservationFulfillment } =
  await import("./reservation-fulfillment.service");
const { WorkspaceReservationEmailService } = await import(
  "./workspace-reservation-email.service"
);

const testDatabase = await connectWorkspacePostgresTestDatabase();

const paidAt = Temporal.Instant.from("2026-01-01T12:00:00.000Z");
const deliveredAt = Temporal.Instant.from("2026-01-01T12:05:00.000Z");

const newDeliveryId = () =>
  EmailDeliveryIdSchema.make(`resend-${crypto.randomUUID()}`);

describe.skipIf(!testDatabase)(
  "ReservationFulfillment completion emits once per transition into fulfilled",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const insertPaidReservation = async (
      fulfillment: FulfillmentState,
      activeCustomerEmailDeliveryId?: EmailDeliveryId
    ) => {
      const { id } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "confirmed", payment: "paid", fulfillment },
          at: paidAt,
          overrides: activeCustomerEmailDeliveryId
            ? { activeCustomerEmailDeliveryId }
            : {},
        })
      );
      reservationIds.push(id);
      return id;
    };

    const readFulfillment = async (id: WorkspaceReservationId) => {
      const [row] = await Effect.runPromise(
        testDatabase.db
          .select({
            fulfillmentState: workspaceReservations.fulfillmentState,
            fulfilledAt: workspaceReservations.fulfilledAt,
            activeCustomerEmailDeliveryId:
              workspaceReservations.activeCustomerEmailDeliveryId,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
      );
      return row;
    };

    // Makes a `processing` claim stale, as a run that stalled past the
    // reclaim window leaves it.
    const stallClaim = (id: WorkspaceReservationId) =>
      testDatabase.db
        .update(workspaceReservations)
        .set({
          updatedAt: Temporal.Now.instant().subtract({
            milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS + 1000,
          }),
        })
        .where(eq(workspaceReservations.id, id));

    /**
     * The fulfillment module over the real ledger and reservation repository
     * on Postgres. `sendCustomerConfirmation` is the provider's acceptance of
     * the customer email; Dotypos, access codes and the author stay out of
     * the way.
     */
    const fulfillmentOnPostgres = (
      sendCustomerConfirmation: () => Effect.Effect<EmailDeliveryId>
    ) => {
      const analytics = recordCheckoutAnalytics();
      const issueAfterFulfillment = mock(() => Effect.void);
      const layer = ReservationFulfillment.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            FulfillmentLedger.Default,
            WorkspaceReservationRepository.Default,
            analytics.layer,
            Layer.mock(ReservationInvoiceService, { issueAfterFulfillment }),
            Layer.mock(WorkspaceReservationService, {
              getReservation: (id) =>
                Effect.succeed({
                  id,
                  dotyposReservationId: "dotypos-reservation-id",
                  dotyposCustomerId: "dotypos-customer-id",
                  reservedFrom: paidAt,
                  reservedUntil: paidAt.add({ hours: 2 }),
                  locale: "cs-CZ",
                } as never),
            }),
            Layer.mock(WorkspaceCheckoutAccessCodeService, {
              resolveCustomerAccessCode: () =>
                Effect.succeed("access-code" as never),
            }),
            Layer.mock(CustomerEmailLocaleService, {
              byDotyposCustomer: () => Effect.succeed({ kind: "guest" }),
            }),
            Layer.mock(ReservationAuthorDirectory, {
              describe: () => Effect.succeed(new Map()),
            }),
            Layer.mock(WorkspaceReservationEmailService, {
              sendPaidReservationEmails: sendCustomerConfirmation,
            }),
            Layer.mock(DotyposService, {})
          ).pipe(Layer.provideMerge(testDatabase.layer))
        )
      );
      const use = <A, E>(
        operation: (
          fulfillment: typeof ReservationFulfillment.Service
        ) => Effect.Effect<A, E>
      ) =>
        Effect.runPromiseExit(
          Effect.gen(function* () {
            return yield* operation(yield* ReservationFulfillment);
          }).pipe(Effect.provide(layer))
        );
      const fulfilledEvents = () =>
        analytics.messages.filter(
          (message) => message.event === "reservation fulfilled"
        );
      return { use, fulfilledEvents, issueAfterFulfillment };
    };

    test("a run that lost the state fence to a reclaiming run never emits a second event", async () => {
      const id = await insertPaidReservation("not_started");
      const stalledDelivery = newDeliveryId();
      const reclaimedDelivery = newDeliveryId();
      let sends = 0;
      let reclaimed: Exit.Exit<void, unknown> | undefined;
      // The first run stalls while its email is out; a second run reclaims
      // the stale claim and completes the order before the first resumes.
      const fulfillment = fulfillmentOnPostgres(() => {
        sends += 1;
        if (sends > 1) return Effect.succeed(reclaimedDelivery);
        return stallClaim(id).pipe(
          Effect.andThen(
            Effect.promise(async () => {
              reclaimed = await fulfillment.use((reclaiming) =>
                reclaiming.run(id)
              );
            })
          ),
          Effect.as(stalledDelivery),
          Effect.orDie
        );
      });

      const stalled = await fulfillment.use((run) => run.run(id));

      expect(reclaimed && Exit.isSuccess(reclaimed)).toBe(true);

      expect(
        Exit.isFailure(stalled) ? Cause.squash(stalled.cause) : stalled
      ).toMatchObject({
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "fulfillment_completion_failed",
      });
      expect(await readFulfillment(id)).toMatchObject({
        fulfillmentState: "fulfilled",
        activeCustomerEmailDeliveryId: reclaimedDelivery,
      });
      expect(fulfillment.fulfilledEvents()).toHaveLength(1);
      expect(fulfillment.fulfilledEvents()[0]).toMatchObject({
        properties: { reservation_id: id },
      });
      expect(fulfillment.issueAfterFulfillment).toHaveBeenCalledTimes(1);
    });

    test("a run on an already fulfilled order retries its invoice without emitting", async () => {
      const id = await insertPaidReservation("not_started");
      const fulfillment = fulfillmentOnPostgres(() =>
        Effect.succeed(newDeliveryId())
      );

      const completed = await fulfillment.use((run) => run.run(id));
      const redelivered = await fulfillment.use((run) => run.run(id));

      expect(Exit.isSuccess(completed)).toBe(true);
      expect(Exit.isSuccess(redelivered)).toBe(true);
      expect((await readFulfillment(id))?.fulfillmentState).toBe("fulfilled");
      expect(fulfillment.fulfilledEvents()).toHaveLength(1);
      expect(fulfillment.issueAfterFulfillment).toHaveBeenCalledTimes(2);
      expect(fulfillment.issueAfterFulfillment).toHaveBeenLastCalledWith({
        reservationId: id,
      });
    });

    test("a redelivered delivered report retries the invoice without emitting", async () => {
      const deliveryId = newDeliveryId();
      const id = await insertPaidReservation("awaiting_delivery", deliveryId);
      const fulfillment = fulfillmentOnPostgres(() =>
        Effect.die("delivery reports send no email")
      );
      const report = {
        deliveryId,
        outcome: "delivered" as const,
        occurredAt: deliveredAt,
        accessEmail: { reservationId: id },
      };

      const applied = await fulfillment.use((delivery) =>
        delivery.recordDelivery(report)
      );
      const redelivered = await fulfillment.use((delivery) =>
        delivery.recordDelivery(report)
      );

      expect(applied).toEqual(Exit.succeed("applied"));
      expect(redelivered).toEqual(
        Exit.succeed({ ignored: "reservation_already_fulfilled" })
      );
      expect(await readFulfillment(id)).toMatchObject({
        fulfillmentState: "fulfilled",
        fulfilledAt: deliveredAt,
      });
      expect(fulfillment.fulfilledEvents()).toHaveLength(1);
      expect(fulfillment.issueAfterFulfillment).toHaveBeenCalledTimes(2);
    });
  }
);
