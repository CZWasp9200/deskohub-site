import { asc, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { WorkspaceCancellations } from "../automation-trigger-verification";

/**
 * Locks the triggering reservations `FOR SHARE`, in id order, and returns
 * when Workspace cancelled those it cancelled (D28). Callers take it after
 * the lifecycle lock; it holds a Workspace cancellation, or a restore
 * undoing one, back until the caller commits.
 */
export const lockTriggeringReservations = (
  reservationIds: readonly (WorkspaceReservationId | null)[]
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    Effect.succeed(
      [...new Set(reservationIds.filter((id) => id !== null))].sort()
    ).pipe(
      Effect.flatMap((ids) =>
        ids.length === 0
          ? Effect.succeed([])
          : db
              .select({
                id: workspaceReservations.id,
                cancelledAt: workspaceReservations.reservationCancelledAt,
              })
              .from(workspaceReservations)
              .where(inArray(workspaceReservations.id, ids))
              .orderBy(asc(workspaceReservations.id))
              .for("share")
      ),
      Effect.map(
        (rows): WorkspaceCancellations =>
          new Map(
            rows.flatMap(({ id, cancelledAt }) =>
              cancelledAt === null ? [] : [[id, cancelledAt] as const]
            )
          )
      )
    )
  );
