import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  reservationAccessGrants,
  reservationInviteeNotices,
  reservationInvitees,
} from "@/db/schema";
import type { RestoredInviteeAccess } from "@/db/schema/reservation-invitee-notices";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { currentInstant } from "@/shared/utils/temporal";
import { ReservationInvitations } from "./reservation-invitations.service";
import { ReservationInvitees } from "./reservation-invitees.service";

const makeNoticeWorker = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const locks = yield* WorkspaceDatabaseAdvisoryLock;
  const invites = yield* ReservationInvitees;
  const reservations = yield* WorkspaceReservationService;
  const delivery = yield* ReservationInvitations;

  const pending = isNull(reservationInviteeNotices.settledAt);
  const settle = (id: string, at: Temporal.Instant) =>
    db
      .update(reservationInviteeNotices)
      .set({ settledAt: at })
      .where(and(eq(reservationInviteeNotices.id, id), pending))
      .pipe(Effect.as("settled" as const));

  const retry = (
    notice: typeof reservationInviteeNotices.$inferSelect,
    now: Temporal.Instant
  ) =>
    db
      .update(reservationInviteeNotices)
      .set({
        attemptCount: sql`${reservationInviteeNotices.attemptCount} + 1`,
        nextAttemptAt: now.add({
          minutes: Math.min(2 ** Math.min(notice.attemptCount, 6), 60),
        }),
      })
      .where(and(eq(reservationInviteeNotices.id, notice.id), pending))
      .pipe(Effect.as("deferred" as const));

  const restoredAccess = Effect.fnUntraced(function* (input: {
    readonly notice: typeof reservationInviteeNotices.$inferSelect;
    readonly reservationId: WorkspaceReservationId;
    readonly reservedUntil: Temporal.Instant;
    readonly now: Temporal.Instant;
  }) {
    const { notice, reservationId, reservedUntil, now } = input;
    if (notice.restoredAccess !== null) return notice.restoredAccess;
    const stillOpen = Temporal.Instant.compare(reservedUntil, now) > 0;
    let access: RestoredInviteeAccess = "past";
    if (stillOpen) {
      const [issued] = yield* db
        .select({ id: reservationAccessGrants.id })
        .from(reservationAccessGrants)
        .where(
          and(
            eq(reservationAccessGrants.workspaceReservationId, reservationId),
            eq(reservationAccessGrants.state, "issued"),
            gte(reservationAccessGrants.issuedAt, notice.occurredAt)
          )
        )
        .limit(1);
      access = issued ? "issued" : "link";
    }
    // An uncertain provider outcome must replay the same restoration copy.
    yield* db
      .update(reservationInviteeNotices)
      .set({ restoredAccess: access })
      .where(and(eq(reservationInviteeNotices.id, notice.id), pending));
    return access;
  });

  const deliver = Effect.fnUntraced(function* (
    notice: typeof reservationInviteeNotices.$inferSelect,
    reservationId: WorkspaceReservationId,
    now: Temporal.Instant
  ) {
    const reservation = yield* reservations.getReservation(reservationId);
    const expectedStatus =
      notice.kind === "cancellation" ? "CANCELLED" : "CONFIRMED";
    // Dotypos can change before the local transaction for the new state.
    // Wait for that transition to replace this notice.
    if (reservation.providerStatus !== expectedStatus) return "retry" as const;
    const candidate = yield* invites.find(reservationId, notice.inviteeId);
    if (Option.isNone(candidate) || candidate.value.email === null)
      return "skipped" as const;
    const invitee = { ...candidate.value, email: candidate.value.email };
    if (
      notice.kind === "invitation" &&
      (invitee.invitationSendCount > 0 ||
        Temporal.Instant.compare(reservation.reservedUntil, now) <= 0)
    )
      return "skipped" as const;
    const access =
      notice.kind === "restoration"
        ? yield* restoredAccess({
            notice,
            reservationId,
            reservedUntil: reservation.reservedUntil,
            now,
          })
        : undefined;
    yield* delivery.deliverNotice({
      reservation,
      invitee,
      kind: notice.kind,
      noticeId: notice.id,
      ...(access && { restoredAccess: access }),
    });
    if (notice.kind === "invitation") {
      yield* invites.markInvitationSent({
        inviteeId: invitee.id,
        sendCount: 1,
        sentAt: yield* currentInstant,
      });
    }
    return "delivered" as const;
  });

  const dispatch = Effect.fnUntraced(function* (input: {
    readonly id: string;
    readonly reservationId: WorkspaceReservationId;
    readonly now: Temporal.Instant;
    readonly deadline: number;
  }) {
    const { id, reservationId, now, deadline } = input;
    return yield* WorkspaceLockSections.reservationInviteeNotices(
      reservationId
    )(
      Effect.gen(function* () {
        const [notice] = yield* db
          .select()
          .from(reservationInviteeNotices)
          .where(
            and(
              eq(reservationInviteeNotices.id, id),
              pending,
              lte(reservationInviteeNotices.nextAttemptAt, now)
            )
          )
          .limit(1);
        if (!notice) return "skipped" as const;

        const remaining = deadline - Date.now();
        if (remaining <= 0) return "deferred" as const;
        const outcome = yield* deliver(notice, reservationId, now).pipe(
          Effect.timeout(Math.min(remaining, 8000)),
          Effect.catch(() =>
            Effect.logWarning("Reservation guest notice will be retried", {
              code: "reservation.invitation.delivery-deferred",
              kind: notice.kind,
            }).pipe(Effect.as("retry" as const))
          )
        );
        return outcome === "retry"
          ? yield* retry(notice, now)
          : yield* settle(id, now).pipe(Effect.as(outcome));
      })
    ).pipe(
      Effect.provideService(WorkspaceDatabaseAdvisoryLock, locks),
      Effect.catch(() =>
        Effect.logWarning("Reservation guest notice dispatch deferred", {
          code: "reservation.invitation.dispatch-deferred",
        }).pipe(Effect.as("deferred" as const))
      )
    );
  });

  const drain = Effect.fn("reservationInviteeNotices.drain")(function* (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) {
    const deadline = Date.now() + 40_000;
    const due = yield* db
      .select({
        id: reservationInviteeNotices.id,
        reservationId: reservationInvitees.workspaceReservationId,
      })
      .from(reservationInviteeNotices)
      .innerJoin(
        reservationInvitees,
        eq(reservationInviteeNotices.inviteeId, reservationInvitees.id)
      )
      .where(
        and(pending, lte(reservationInviteeNotices.nextAttemptAt, input.now))
      )
      .orderBy(
        asc(reservationInviteeNotices.nextAttemptAt),
        asc(reservationInviteeNotices.id)
      )
      .limit(input.limit);
    const outcomes = yield* Effect.forEach(
      due,
      (notice) =>
        Date.now() >= deadline
          ? Effect.succeed("deferred" as const)
          : dispatch({ ...notice, now: input.now, deadline }),
      { concurrency: 3 }
    );
    return {
      delivered: outcomes.filter((outcome) => outcome === "delivered").length,
      deferred: outcomes.filter((outcome) => outcome === "deferred").length,
      skipped: outcomes.filter((outcome) => outcome === "skipped").length,
    };
  });

  return { drain };
});

export class ReservationInviteeNoticeWorker extends Context.Service<
  ReservationInviteeNoticeWorker,
  Effect.Success<typeof makeNoticeWorker>
>()("@deskohub-workspace/ReservationInviteeNoticeWorker") {
  static Default = Layer.effect(this, makeNoticeWorker);

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDatabaseAdvisoryLock.Default,
        ReservationInvitees.Default,
        ReservationInvitations.Live.pipe(Layer.provide(WorkspaceEmailLayer)),
        WorkspaceReservationService.Live
      )
    )
  );
}
