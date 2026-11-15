import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "@/db/database.service";
import { customerEvents } from "@/db/schema";
import { automationWorkUnitIdSchema } from "@/features/email-campaigns/automation/automation-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { recordCustomerEvent } from "./customer-event-outbox";
import { retractCancellationEvent } from "./customer-event-retraction";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const at = (hour: number) =>
  Temporal.Instant.from("2091-03-01T00:00:00Z").add({ hours: hour });

describe.skipIf(!testDatabase)(
  "retractCancellationEvent on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      // Deleting a reservation also deletes its events.
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const runInTransaction = <A, E>(
      effect: Effect.Effect<A, E, WorkspaceTransaction>
    ) =>
      Effect.runPromise(
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(effect)
        ).pipe(Effect.provide(testDatabase.layer))
      );

    /** A booked reservation cancelled at each instant, one event per cancellation. */
    const cancelledReservation = async (
      ...cancellations: readonly Temporal.Instant[]
    ) => {
      const [reservation] = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservations([
          {
            stage: { reservation: "cancelled", payment: "paid" },
            at: cancellations.at(-1) ?? at(2),
            overrides: { reservationConfirmedAt: at(1) },
          },
        ])
      );
      const id = reservation!.id;
      reservationIds.push(id);
      for (const occurredAt of cancellations) {
        await runInTransaction(
          recordCustomerEvent({
            kind: "reservation-cancelled",
            occurredAt,
            dotyposCustomerId: reservation!.dotyposCustomerId,
            workspaceReservationId: id,
          })
        );
      }
      return id;
    };

    const retract = (
      id: WorkspaceReservationId,
      cancelledAt: Temporal.Instant
    ) =>
      runInTransaction(
        retractCancellationEvent({
          reservationId: id,
          cancelledAt,
          at: at(10),
        })
      );

    const readEvents = (id: WorkspaceReservationId) =>
      Effect.runPromise(
        testDatabase.db
          .select({
            occurredAt: customerEvents.occurredAt,
            automationUnitId: customerEvents.automationUnitId,
            automationProcessedAt: customerEvents.automationProcessedAt,
          })
          .from(customerEvents)
          .where(eq(customerEvents.workspaceReservationId, id))
          .orderBy(customerEvents.occurredAt)
      );

    test("marks an unplanned event of the undone cancellation processed and leaves the others", async () => {
      const id = await cancelledReservation(at(2), at(4));

      expect(await retract(id, at(2))).toBe("retracted");
      expect(await retract(id, at(2))).toBe("processed");
      expect(await readEvents(id)).toEqual([
        {
          occurredAt: at(2),
          automationUnitId: null,
          automationProcessedAt: at(10),
        },
        {
          occurredAt: at(4),
          automationUnitId: null,
          automationProcessedAt: null,
        },
      ]);
    });

    test("leaves an event an intake unit owns to intake", async () => {
      const id = await cancelledReservation(at(2));
      const unitId = Schema.decodeSync(automationWorkUnitIdSchema)(
        crypto.randomUUID()
      );
      await Effect.runPromise(
        testDatabase.db
          .update(customerEvents)
          .set({ automationUnitId: unitId })
          .where(eq(customerEvents.workspaceReservationId, id))
      );

      expect(await retract(id, at(2))).toBe("in_intake");
      expect(await readEvents(id)).toEqual([
        {
          occurredAt: at(2),
          automationUnitId: unitId,
          automationProcessedAt: null,
        },
      ]);
    });

    test("keeps the processing time of an event automations already took in", async () => {
      const id = await cancelledReservation(at(2));
      await Effect.runPromise(
        testDatabase.db
          .update(customerEvents)
          .set({ automationProcessedAt: at(3) })
          .where(eq(customerEvents.workspaceReservationId, id))
      );

      expect(await retract(id, at(2))).toBe("processed");
      expect((await readEvents(id))[0]?.automationProcessedAt).toEqual(at(3));
    });

    test("reports a cancellation with no event", async () => {
      const id = await cancelledReservation();

      expect(await retract(id, at(2))).toBe("absent");
    });

    test("skips an event the planner holds instead of waiting for it", async () => {
      const id = await cancelledReservation(at(2));
      const planner = await testDatabase.pool.connect();
      try {
        await planner.query("begin");
        await planner.query(
          "select id from customer_events where workspace_reservation_id = $1 for update",
          [id]
        );

        expect(await retract(id, at(2))).toBe("in_intake");
      } finally {
        await planner.query("rollback");
        planner.release();
      }
      expect((await readEvents(id))[0]?.automationProcessedAt).toBeNull();
    });
  }
);
