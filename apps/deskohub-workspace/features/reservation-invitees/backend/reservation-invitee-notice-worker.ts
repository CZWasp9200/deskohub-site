import { createHmac } from "node:crypto";
import { resendIdempotencyMismatchCode } from "@deskohub/email-resend";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { Context, Effect, Layer, Option, Redacted, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  reservationAccessGrants,
  reservationInviteeNotices,
  reservationInvitees,
} from "@/db/schema";
import type {
  InviteeNoticeUncertainty,
  RestoredInviteeAccess,
} from "@/db/schema/reservation-invitee-notices";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import type { InviteeEmail } from "@/features/office/office-people";
import {
  type WorkspaceReservationDetails,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import {
  deriveSealedStateSubkey,
  SealedStateKeys,
} from "@/shared/backend/sealed-state-keys.service";
import { currentInstant } from "@/shared/utils/temporal";
import { invitationResendCooldown } from "../reservation-people-view";
import {
  InvitationResendRefused,
  ReservationInvitations,
} from "./reservation-invitations.service";
import {
  ReservationInviteeNoticeTransport,
  resendNoticeReplayMinutes,
} from "./reservation-invitee-notice-transport";
import {
  type ReservationInvitee,
  ReservationInviteeStorageError,
  ReservationInvitees,
} from "./reservation-invitees.service";

type Notice = typeof reservationInviteeNotices.$inferSelect;
type DispatchOutcome =
  | { readonly status: "delivered"; readonly sentAt: Temporal.Instant }
  | { readonly status: "uncertain"; readonly reason: InviteeNoticeUncertainty }
  | { readonly status: "retry" | "skipped" | "deferred" };

const resendUnavailable = () =>
  new ReservationInviteeStorageError({
    operation: "write",
    message: "The invitation could not be sent.",
  });

const makeNoticeWorker = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const locks = yield* WorkspaceDatabaseAdvisoryLock;
  const invites = yield* ReservationInvitees;
  const reservations = yield* WorkspaceReservationService;
  const renderer = yield* ReservationInvitations;
  const transport = yield* ReservationInviteeNoticeTransport;
  const { ring } = yield* SealedStateKeys;
  const fingerprintKey = (entry: (typeof ring)[number]) =>
    deriveSealedStateSubkey(
      entry,
      "deskohub-workspace/reservation-invitee-notice-request"
    );
  const firstFingerprintKey = fingerprintKey(ring[0]);
  const fingerprintKeys = [
    firstFingerprintKey,
    ...ring.slice(1).map(fingerprintKey),
  ];

  const pending = isNull(reservationInviteeNotices.settledAt);
  const updateNotice = (
    id: string,
    values: Partial<typeof reservationInviteeNotices.$inferInsert>
  ) =>
    db
      .update(reservationInviteeNotices)
      .set(values)
      .where(and(eq(reservationInviteeNotices.id, id), pending));

  const retry = (notice: Notice, now: Temporal.Instant) =>
    updateNotice(notice.id, {
      attemptCount: notice.attemptCount + 1,
      nextAttemptAt: now.add({
        minutes: Math.min(2 ** Math.min(notice.attemptCount, 6), 60),
      }),
    });

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
    notice: Notice,
    reservation: WorkspaceReservationDetails,
    candidate: Option.Option<ReservationInvitee>,
    now: Temporal.Instant
  ): Effect.fn.Return<DispatchOutcome, unknown> {
    const { requestStartedAt, requestFingerprint } = notice;
    const expectedStatus =
      notice.kind === "cancellation" ? "CANCELLED" : "CONFIRMED";
    // Dotypos can change before the local transaction for the new state.
    // Wait for that transition to replace this notice.
    if (reservation.providerStatus !== expectedStatus)
      return { status: "retry" };
    if (
      Option.isNone(candidate) ||
      candidate.value.email === null ||
      (notice.kind === "invitation" &&
        Temporal.Instant.compare(reservation.reservedUntil, now) <= 0)
    ) {
      return requestStartedAt === null
        ? { status: "skipped" }
        : { status: "uncertain", reason: "not-replayable" };
    }
    const invitee = { ...candidate.value, email: candidate.value.email };
    const access =
      notice.kind === "restoration"
        ? yield* restoredAccess({
            notice,
            reservationId: reservation.id,
            reservedUntil: reservation.reservedUntil,
            now,
          })
        : undefined;
    const message = yield* renderer.renderNotice({
      reservation,
      invitee,
      kind: notice.kind,
      noticeId: notice.id,
      ...(access && { restoredAccess: access }),
    });
    const request = transport.prepare(message);
    const fingerprint = (key: Buffer) =>
      createHmac("sha256", key)
        .update(Redacted.value(request.identity))
        .digest("base64url");

    const clockNow = yield* currentInstant;
    const dispatchAt =
      Temporal.Instant.compare(now, clockNow) > 0 ? now : clockNow;
    if (requestStartedAt !== null) {
      if (
        !fingerprintKeys.some((key) => fingerprint(key) === requestFingerprint)
      ) {
        return { status: "uncertain", reason: "request-changed" };
      }
      if (request.replayWindowMinutes === 0) {
        return { status: "uncertain", reason: "not-replayable" };
      }
      if (
        Temporal.Instant.compare(
          dispatchAt,
          requestStartedAt.add({ minutes: request.replayWindowMinutes })
        ) >= 0
      ) {
        return { status: "uncertain", reason: "replay-expired" };
      }
    } else {
      // This write commits before we start the provider request. A worker
      // replacement can then tell an unstarted notice from an uncertain send.
      const [registered] = yield* updateNotice(notice.id, {
        requestStartedAt: dispatchAt,
        requestFingerprint: fingerprint(firstFingerprintKey),
      }).returning({ id: reservationInviteeNotices.id });
      if (!registered) return { status: "skipped" };
    }

    const sent = yield* Effect.result(request.send);
    if (Result.isFailure(sent)) {
      if (sent.failure.code === resendIdempotencyMismatchCode) {
        return { status: "uncertain", reason: "request-changed" };
      }
      // A fresh request's definite refusal proves nothing was sent. The
      // same refusal on replay cannot resolve a previous unknown outcome.
      if (
        requestStartedAt === null &&
        sent.failure._tag === "EmailServiceError"
      ) {
        yield* updateNotice(notice.id, {
          requestStartedAt: null,
          requestFingerprint: null,
        });
      }
      return { status: "retry" };
    }

    const sentAt = yield* currentInstant;
    const accepted = yield* invites.acceptNotice({
      noticeId: notice.id,
      ...(notice.kind === "invitation" && { invitationRecipient: invitee.id }),
      sentAt,
    });
    return accepted ? { status: "delivered", sentAt } : { status: "skipped" };
  });

  const process = Effect.fnUntraced(function* (
    notice: Notice,
    now: Temporal.Instant,
    remaining: number,
    load: Effect.Effect<
      {
        readonly reservation: WorkspaceReservationDetails;
        readonly candidate: Option.Option<ReservationInvitee>;
      },
      unknown
    >
  ) {
    if (remaining <= 0) return { status: "deferred" } as const;
    const expired =
      notice.requestStartedAt !== null &&
      Temporal.Instant.compare(
        now,
        notice.requestStartedAt.add({ minutes: resendNoticeReplayMinutes })
      ) >= 0;
    const outcome: DispatchOutcome = expired
      ? { status: "uncertain", reason: "replay-expired" }
      : yield* load.pipe(
          Effect.flatMap(({ reservation, candidate }) =>
            deliver(notice, reservation, candidate, now)
          ),
          Effect.timeout(Math.min(remaining, 8_000)),
          Effect.catch(() => Effect.succeed({ status: "retry" } as const))
        );
    switch (outcome.status) {
      case "retry":
        yield* retry(notice, now);
        yield* Effect.logWarning("Reservation guest notice will be retried", {
          code: "reservation.invitation.delivery-deferred",
          kind: notice.kind,
        });
        return { status: "deferred" } as const;
      case "uncertain":
        yield* updateNotice(notice.id, {
          settledAt: now,
          uncertainty: outcome.reason,
        });
        yield* Effect.logWarning(
          "Reservation guest notice acceptance is uncertain",
          {
            code: `reservation.invitation.${outcome.reason}`,
            kind: notice.kind,
          }
        );
        return outcome;
      case "skipped":
        yield* updateNotice(notice.id, { settledAt: now });
        return outcome;
      default:
        return outcome;
    }
  });

  // The caller holds the order's invitee-notice lock and has checked the
  // reservation is paid and confirmed.
  const resendUnderNoticeLock = Effect.fn("reservationInviteeNotices.resend")(
    function* (input: {
      readonly reservation: WorkspaceReservationDetails;
      readonly invitee: ReservationInvitee & { readonly email: InviteeEmail };
    }) {
      const { reservation, invitee } = input;
      const { id: inviteeId, lastInvitationSentAt } = invitee;
      const now = yield* currentInstant;
      const retryAt = lastInvitationSentAt?.add(invitationResendCooldown);
      if (retryAt && Temporal.Instant.compare(now, retryAt) < 0) {
        return yield* new InvitationResendRefused({
          refusal: { reason: "cooldown", retryAt },
        });
      }

      const [latest] = yield* db
        .select()
        .from(reservationInviteeNotices)
        .where(eq(reservationInviteeNotices.inviteeId, inviteeId))
        .orderBy(
          desc(reservationInviteeNotices.occurredAt),
          desc(reservationInviteeNotices.id)
        )
        .limit(1);
      if (latest?.kind === "invitation" && latest.uncertainty !== null) {
        return yield* resendUnavailable();
      }
      const [notice] =
        latest?.kind === "invitation" && latest.settledAt === null
          ? [latest]
          : yield* db
              .insert(reservationInviteeNotices)
              .values({
                inviteeId,
                kind: "invitation",
                occurredAt: now,
                nextAttemptAt: now,
              })
              .returning();
      if (!notice || Temporal.Instant.compare(notice.nextAttemptAt, now) > 0) {
        return yield* resendUnavailable();
      }

      const outcome = yield* process(
        notice,
        now,
        8_000,
        Effect.succeed({ reservation, candidate: Option.some(invitee) })
      );
      if (outcome.status !== "delivered") return yield* resendUnavailable();
      return {
        invitationSentAt: outcome.sentAt,
        resendAvailableAt: outcome.sentAt.add(invitationResendCooldown),
      };
    }
  );

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
        const outcome = yield* process(
          notice,
          now,
          deadline - Date.now(),
          Effect.gen(function* () {
            const reservation =
              yield* reservations.getReservation(reservationId);
            const candidate = yield* invites.find(
              reservationId,
              notice.inviteeId
            );
            return { reservation, candidate };
          })
        );
        return outcome.status;
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
      uncertain: outcomes.filter((outcome) => outcome === "uncertain").length,
    };
  });

  return { drain, resendUnderNoticeLock };
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
        ReservationInviteeNoticeTransport.Live,
        SealedStateKeys.Default,
        WorkspaceReservationService.Live
      )
    )
  );
}
