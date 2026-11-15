import { and, eq, inArray, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { customerEvents } from "@/db/schema/customer-events";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

/**
 * What retracting an undone cancellation's event found:
 * - `retracted`: no automation had planned it, and now none will;
 * - `in_intake`: intake owns or is planning it, and withdraws it when it
 *   finds the reservation no longer cancelled at that instant;
 * - `processed`: automations already took it in, and their runs are
 *   withdrawn before they send;
 * - `absent`: no event records that cancellation.
 */
export type CancellationEventRetraction =
  | "retracted"
  | "in_intake"
  | "processed"
  | "absent";

/**
 * Retracts the `reservation-cancelled` event of a cancellation a restore
 * undoes, in the restore's transaction, after it has locked and restored
 * the reservation row. The event stays as history. An event no intake unit
 * owns is marked processed, so the planner neither plans it nor withdraws
 * the restored reservation's runs for it. An event intake holds is left to
 * intake, which locks the reservation before it writes (§5.6), so the
 * event's row lock is never waited on: it is skipped, not awaited.
 */
export const retractCancellationEvent = (input: {
  readonly reservationId: WorkspaceReservationId;
  /** The undone cancellation's `reservation_cancelled_at`. */
  readonly cancelledAt: Temporal.Instant;
  readonly at: Temporal.Instant;
}): Effect.Effect<
  CancellationEventRetraction,
  EffectDrizzleQueryError,
  WorkspaceTransaction
> =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceTransaction;
    const ofCancellation = and(
      eq(customerEvents.kind, "reservation-cancelled"),
      eq(customerEvents.workspaceReservationId, input.reservationId),
      eq(customerEvents.occurredAt, input.cancelledAt)
    );
    const retracted = yield* db
      .update(customerEvents)
      .set({ automationProcessedAt: input.at })
      .where(
        inArray(
          customerEvents.id,
          db
            .select({ id: customerEvents.id })
            .from(customerEvents)
            .where(
              and(
                ofCancellation,
                isNull(customerEvents.automationProcessedAt),
                isNull(customerEvents.automationUnitId)
              )
            )
            .for("update", { skipLocked: true })
        )
      )
      .returning({ id: customerEvents.id });
    if (retracted.length > 0) return "retracted";

    const [event] = yield* db
      .select({ processedAt: customerEvents.automationProcessedAt })
      .from(customerEvents)
      .where(ofCancellation);
    if (event === undefined) return "absent";
    return event.processedAt === null ? "in_intake" : "processed";
  }).pipe(Effect.withSpan("customerEvents.retractCancellationEvent"));
