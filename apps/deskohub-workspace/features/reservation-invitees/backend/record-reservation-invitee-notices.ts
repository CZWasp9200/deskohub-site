import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { reservationInviteeNotices, reservationInvitees } from "@/db/schema";
import type { ReservationInviteeNoticeKind } from "@/db/schema/reservation-invitee-notices";
import { WorkspaceLocks } from "@/db/workspace-locks";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

/**
 * A booking transition records one notice per current recipient in its own
 * transaction. A new transition retires every still-pending older notice so
 * retrying a stale cancellation can never follow a restoration.
 */
export const recordReservationInviteeNotices = Effect.fn(
  "reservationInviteeNotices.record"
)(function* (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly kind: ReservationInviteeNoticeKind;
  readonly occurredAt: Temporal.Instant;
}) {
  const { db } = yield* WorkspaceTransaction;
  const belongsToReservation = eq(
    reservationInvitees.workspaceReservationId,
    input.reservationId
  );
  const guests = db
    .select({ id: reservationInvitees.id })
    .from(reservationInvitees);

  yield* WorkspaceLocks.reservationInviteeNotices(input.reservationId);
  yield* db
    .update(reservationInviteeNotices)
    .set({
      settledAt: input.occurredAt,
      uncertainty: sql`case when ${reservationInviteeNotices.requestStartedAt} is not null then 'superseded' end`,
    })
    .where(
      and(
        isNull(reservationInviteeNotices.settledAt),
        inArray(
          reservationInviteeNotices.inviteeId,
          guests.where(belongsToReservation)
        ),
        or(
          ne(reservationInviteeNotices.kind, input.kind),
          ne(reservationInviteeNotices.occurredAt, input.occurredAt)
        )
      )
    );
  const recipients = yield* db
    .select({ id: reservationInvitees.id })
    .from(reservationInvitees)
    .where(and(belongsToReservation, isNotNull(reservationInvitees.keyId)));
  if (recipients.length === 0) return;

  yield* db
    .insert(reservationInviteeNotices)
    .values(
      recipients.map(({ id }) => ({
        inviteeId: id,
        kind: input.kind,
        occurredAt: input.occurredAt,
      }))
    )
    .onConflictDoNothing();
});
