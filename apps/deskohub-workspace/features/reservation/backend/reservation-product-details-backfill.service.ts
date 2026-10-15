import { type DotyposReservationId, DotyposService } from "@deskohub/dotypos";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import { findMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-time";
import { getOfficeReservationSelection } from "@/features/reservation/office-reservation";
import {
  type StoredWorkspaceReservationDetails,
  storedWorkspaceReservationDetailsSchema,
  type WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import { reservationIntervalSchema } from "@/features/reservation/reservation-interval";
import {
  meetingRoomReservationKind,
  officeReservationKind,
} from "@/features/reservation/reservation-kind";
import { dotyposReservationSeatsSchema } from "@/features/reservation/reservation-seats";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

/** Rows read, and Dotypos reservations requested, per batch. */
const reservationProductDetailsBackfillBatchSize = 50;

const backfilledFamilies = [meetingRoomReservationKind, officeReservationKind];

type ReservationProductDetailsBackfillFamily =
  (typeof backfilledFamilies)[number];

type ReservationProductDetailsUnresolvedReason =
  | "stored_details_malformed"
  | "dotypos_reservation_id_missing"
  | "dotypos_reservation_not_found"
  | "dotypos_interval_invalid"
  | "interval_not_in_catalog"
  | "dotypos_seats_invalid";

export type ReservationProductDetailsBackfillBatch = {
  readonly updated: number;
  readonly alreadyComplete: number;
  readonly unresolved: readonly {
    readonly reservationId: WorkspaceReservationId;
    readonly family: ReservationProductDetailsBackfillFamily;
    readonly reason: ReservationProductDetailsUnresolvedReason;
  }[];
  /** Pass as `after` for the next batch; null once every row was read. */
  readonly nextCursor: WorkspaceReservationId | null;
};

class ReservationProductDetailsBackfillError extends Data.TaggedError(
  "ReservationProductDetailsBackfillError"
)<{ readonly message: string; readonly cause: unknown }> {}

interface IReservationProductDetailsBackfill {
  /**
   * Fills the catalog identity of meeting-room and office snapshots written
   * before snapshots recorded it, from the booked Dotypos interval and seats.
   * Reads one batch of rows after `after` in ID order. Rows that already have
   * it, and rows it can't resolve, are left as they are, so it's idempotent.
   */
  readonly runBatch: (input: {
    readonly after: WorkspaceReservationId | null;
    readonly dryRun: boolean;
  }) => Effect.Effect<
    ReservationProductDetailsBackfillBatch,
    ReservationProductDetailsBackfillError
  >;
}

type DotyposReservation = Effect.Success<
  ReturnType<DotyposService["Service"]["listReservations"]>
>[number];

const storedFamily = sql<ReservationProductDetailsBackfillFamily>`${workspaceReservations.reservationDetails}->>'kind'`;

const decodeStoredDetails = Schema.decodeUnknownOption(
  storedWorkspaceReservationDetailsSchema,
  { onExcessProperty: "error" }
);
const decodeInterval = Schema.decodeUnknownOption(reservationIntervalSchema);
const decodeSeats = Schema.decodeUnknownOption(dotyposReservationSeatsSchema);

const isComplete = (details: StoredWorkspaceReservationDetails) => {
  switch (details.kind) {
    case "meeting-room":
      return details.duration !== undefined;
    case "office":
      return details.seats !== undefined && details.dayCount !== undefined;
    default:
      return true;
  }
};

/**
 * The full snapshot for an incomplete row, from the Dotypos reservation's
 * interval and seats only. The reservation note is freeform and never read.
 */
const resolveDetails = (
  family: ReservationProductDetailsBackfillFamily,
  reservation: DotyposReservation
):
  | { readonly details: StoredWorkspaceReservationDetails }
  | { readonly reason: ReservationProductDetailsUnresolvedReason } => {
  const interval = decodeInterval({
    startsAt: reservation.startDate,
    endsAt: reservation.endDate,
  });
  if (Option.isNone(interval)) return { reason: "dotypos_interval_invalid" };
  const startsAt = Temporal.Instant.from(interval.value.startsAt);
  const endsAt = Temporal.Instant.from(interval.value.endsAt);

  if (family === meetingRoomReservationKind) {
    const duration = findMeetingRoomReservationDuration({ startsAt, endsAt });
    return duration
      ? { details: { kind: meetingRoomReservationKind, duration } }
      : { reason: "interval_not_in_catalog" };
  }

  const seats = decodeSeats(reservation.seats);
  if (Option.isNone(seats)) return { reason: "dotypos_seats_invalid" };
  const selection = getOfficeReservationSelection({
    startsAt,
    endsAt,
    seats: seats.value,
  });
  return selection
    ? { details: { kind: officeReservationKind, ...selection } }
    : { reason: "interval_not_in_catalog" };
};

export class ReservationProductDetailsBackfill extends Context.Service<
  ReservationProductDetailsBackfill,
  IReservationProductDetailsBackfill
>()("@deskohub-workspace/reservation/ReservationProductDetailsBackfill") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;

      const fail = (message: string) => (cause: unknown) =>
        new ReservationProductDetailsBackfillError({ message, cause });

      return {
        runBatch: Effect.fn("ReservationProductDetailsBackfill.runBatch")(
          function* ({ after, dryRun }) {
            const rows = yield* db
              .select({
                id: workspaceReservations.id,
                family: storedFamily,
                dotyposReservationId:
                  workspaceReservations.dotyposReservationId,
                reservationDetails: workspaceReservations.reservationDetails,
              })
              .from(workspaceReservations)
              .where(
                and(
                  inArray(storedFamily, backfilledFamilies),
                  after === null
                    ? undefined
                    : gt(workspaceReservations.id, after)
                )
              )
              .orderBy(asc(workspaceReservations.id))
              .limit(reservationProductDetailsBackfillBatchSize)
              .pipe(Effect.mapError(fail("Reservations could not be read.")));

            const unresolved: ReservationProductDetailsBackfillBatch["unresolved"][number][] =
              [];
            let alreadyComplete = 0;
            const incomplete: {
              readonly id: WorkspaceReservationId;
              readonly family: ReservationProductDetailsBackfillFamily;
              readonly dotyposReservationId: DotyposReservationId;
              readonly reservationDetails: unknown;
            }[] = [];
            for (const { family, ...row } of rows) {
              const details = decodeStoredDetails(row.reservationDetails);
              if (Option.isNone(details)) {
                unresolved.push({
                  reservationId: row.id,
                  family,
                  reason: "stored_details_malformed",
                });
              } else if (isComplete(details.value)) {
                alreadyComplete += 1;
              } else if (row.dotyposReservationId === null) {
                unresolved.push({
                  reservationId: row.id,
                  family,
                  reason: "dotypos_reservation_id_missing",
                });
              } else {
                incomplete.push({
                  id: row.id,
                  family,
                  dotyposReservationId: row.dotyposReservationId,
                  reservationDetails: row.reservationDetails,
                });
              }
            }

            const dotyposReservations =
              incomplete.length === 0
                ? []
                : yield* dotypos
                    .listReservations({
                      ids: incomplete.map(
                        ({ dotyposReservationId }) => dotyposReservationId
                      ),
                    })
                    .pipe(
                      Effect.mapError(
                        fail("Dotypos reservations could not be loaded.")
                      )
                    );
            const dotyposById = new Map(
              dotyposReservations.map(
                (reservation) => [reservation.id, reservation] as const
              )
            );

            let updated = 0;
            for (const row of incomplete) {
              const reservation = dotyposById.get(row.dotyposReservationId);
              const resolution = reservation
                ? resolveDetails(row.family, reservation)
                : ({ reason: "dotypos_reservation_not_found" } as const);
              if ("reason" in resolution) {
                unresolved.push({
                  reservationId: row.id,
                  family: row.family,
                  reason: resolution.reason,
                });
                continue;
              }
              if (dryRun) {
                updated += 1;
                continue;
              }
              // Only the snapshot read above is replaced, so a concurrent
              // change wins. updated_at stays: it records business activity,
              // and claims compare it.
              const written = yield* db
                .update(workspaceReservations)
                .set({ reservationDetails: resolution.details })
                .where(
                  and(
                    eq(workspaceReservations.id, row.id),
                    sql`${workspaceReservations.reservationDetails} = ${JSON.stringify(row.reservationDetails)}::jsonb`
                  )
                )
                .returning({ id: workspaceReservations.id })
                .pipe(
                  Effect.mapError(fail("A reservation could not be updated."))
                );
              updated += written.length;
            }

            return {
              updated,
              alreadyComplete,
              unresolved,
              nextCursor:
                rows.length < reservationProductDetailsBackfillBatchSize
                  ? null
                  : (rows.at(-1)?.id ?? null),
            };
          }
        ),
      } satisfies IReservationProductDetailsBackfill;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, WorkspaceDotyposLayer)
    )
  );
}
