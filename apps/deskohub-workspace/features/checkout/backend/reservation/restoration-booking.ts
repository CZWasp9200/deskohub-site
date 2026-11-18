import "@/shared/polyfills/temporal";

import type { DotyposReservationBooking } from "@deskohub/dotypos";
import { Data, Effect, Match, Option } from "effect";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import {
  type BookedInterval,
  decodeBookedReservation,
} from "@/features/reservation/backend/booked-reservation";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { getBookedCoworkStay } from "@/features/reservation/cowork-stay";
import {
  getMeetingRoomReservationInterval,
  getMeetingRoomStartDateTime,
} from "@/features/reservation/meeting-room-reservation-time";
import { getOfficeReservationSelection } from "@/features/reservation/office-reservation";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { getWorkspaceDate } from "@/features/reservation/reservation-date";
import type { ReservationInterval } from "@/features/reservation/reservation-interval";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import {
  getOrderCoworkStay,
  rebuildAcceptedReservation,
} from "./order-dotypos-reservation";
import {
  getWorkspaceReservationInterval,
  getWorkspaceReservationSeats,
} from "./workspace-table-assignment.service";
import { workspaceBookingSeatCount } from "./workspace-table-occupancy";

/** The Dotypos record no longer holds the booking Workspace stored. */
class RestorationBookingChanged extends Data.TaggedError(
  "RestorationBookingChanged"
)<{
  readonly message: string;
}> {}

/**
 * The booking can't be determined: the Dotypos record has no readable table,
 * span or seats, or the reservation's own booking facts can't be read.
 */
class RestorationBookingUnreadable extends Data.TaggedError(
  "RestorationBookingUnreadable"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type RestorationReservation = Pick<
  WorkspaceReservation,
  "id" | "activePaymentAttemptId" | "dotyposCustomerId" | "reservationDetails"
>;

/** What the record holds: its table, the span Dotypos holds, and seats. */
type RecordBooking = {
  readonly held: BookedInterval;
  readonly booked: BookedInterval;
  readonly seats: number;
};

const sameInstant = (left: Temporal.Instant, right: Temporal.Instant) =>
  Temporal.Instant.compare(left, right) === 0;

const sameInterval = (
  expected: Pick<ReservationInterval, "startsAt" | "endsAt">,
  actual: BookedInterval
) =>
  sameInstant(Temporal.Instant.from(expected.startsAt), actual.startsAt) &&
  sameInstant(Temporal.Instant.from(expected.endsAt), actual.endsAt);

const readRecordBooking = (
  record: ReservationRecord,
  details: StoredWorkspaceReservationDetails
) => {
  const decoded = decodeBookedReservation(record, details);
  return Option.all({
    held: decoded.occupiedInterval,
    booked: decoded.interval,
    seats: decoded.seats,
  }).pipe(
    Option.match({
      onNone: () =>
        Effect.fail(
          new RestorationBookingUnreadable({
            message:
              "The Dotypos reservation's held span or seats can't be read.",
          })
        ),
      onSome: (booking): Effect.Effect<RecordBooking> =>
        Effect.succeed(booking),
    })
  );
};

const changed = (fields: readonly string[]) =>
  new RestorationBookingChanged({
    message: `The Dotypos reservation no longer books the reservation's ${fields.join(", ")}.`,
  });

/**
 * The booking the reservation's creation made, from the accounting snapshot
 * of the payment that accepted it: its held span and seats are rebuilt the way
 * reservation creation builds them, independently of the record.
 */
const getCreationBooking = Effect.fnUntraced(function* (input: {
  readonly reservation: RestorationReservation;
  readonly recordBooking: RecordBooking;
  readonly snapshot: AccountingDocumentSnapshot;
}) {
  const reconstructed = rebuildAcceptedReservation(
    input.reservation,
    input.snapshot,
    getOrderCoworkStay(
      input.reservation.reservationDetails,
      input.recordBooking.booked
    )
  );
  if (!reconstructed) {
    return yield* new RestorationBookingUnreadable({
      message:
        "The payment's accounting snapshot is of another reservation kind than the stored details.",
    });
  }
  const interval = yield* getWorkspaceReservationInterval(
    reconstructed.reservation
  ).pipe(
    Effect.mapError(
      (cause) =>
        new RestorationBookingUnreadable({
          message: "The reservation's booked span can't be rebuilt.",
          cause,
        })
    )
  );
  const seats = getWorkspaceReservationSeats(reconstructed.reservation);

  const { held } = input.recordBooking;
  const changedFields = [
    ...(sameInstant(Temporal.Instant.from(interval.startsAt), held.startsAt)
      ? []
      : ["start"]),
    ...(sameInstant(Temporal.Instant.from(interval.endsAt), held.endsAt)
      ? []
      : ["end"]),
    ...(seats === input.recordBooking.seats ? [] : ["seats"]),
  ];
  if (changedFields.length > 0) return yield* changed(changedFields);

  return {
    startDate: temporalInstantToDate(Temporal.Instant.from(interval.startsAt)),
    endDate: temporalInstantToDate(Temporal.Instant.from(interval.endsAt)),
    seats,
  };
});

/**
 * The booking facts the stored details determine on their own, checked
 * against the record; the rest is taken from the record. Cowork stores its
 * tier, which fixes the hours of the booked date; a meeting room may store
 * its duration; an office may store its seats and day count.
 */
const storedDetailChanges = (
  details: StoredWorkspaceReservationDetails,
  { held, booked, seats }: RecordBooking
): readonly string[] =>
  Match.value(details).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ entryTier }) => [
        ...(sameInterval(
          getCoworkReservationInterval(
            entryTier,
            getWorkspaceDate(held.startsAt).toString(),
            getBookedCoworkStay({ tier: entryTier, interval: booked })
          ),
          held
        )
          ? []
          : ["tier hours"]),
        ...(seats === workspaceBookingSeatCount ? [] : ["seats"]),
      ],
      "meeting-room": ({ duration }) => {
        const durationInterval =
          duration === undefined
            ? undefined
            : getMeetingRoomReservationInterval(
                getMeetingRoomStartDateTime(booked.startsAt),
                duration
              );
        return [
          ...(durationInterval === undefined ||
          (durationInterval !== null && sameInterval(durationInterval, booked))
            ? []
            : ["duration"]),
          ...(seats === workspaceBookingSeatCount ? [] : ["seats"]),
        ];
      },
      office: (office) => {
        const selection = getOfficeReservationSelection({
          startsAt: held.startsAt,
          endsAt: held.endsAt,
          seats,
        });
        return [
          ...(selection !== null &&
          (office.dayCount === undefined ||
            office.dayCount === selection.dayCount)
            ? []
            : ["day count"]),
          ...(office.seats === undefined || office.seats === seats
            ? []
            : ["seats"]),
        ];
      },
    })
  );

/**
 * The booking a restore asks Dotypos to confirm again: the reservation's
 * customer, the table of its Dotypos record, and the held span and seats its
 * creation booked. Those are rebuilt from the accounting snapshot of the
 * reservation's paid attempt, the way late-payment recovery rebuilds the
 * reservation, and the record must still hold them. A reservation without a
 * snapshot takes its span and seats from the record, checked against what its
 * stored details determine, and logs a warning.
 */
export const getRestorationBooking = Effect.fn("getRestorationBooking")(
  function* (input: {
    readonly reservation: RestorationReservation;
    readonly record: ReservationRecord;
  }) {
    const { reservation, record } = input;
    const tableId = record._tableId;
    if (!tableId) {
      return yield* new RestorationBookingUnreadable({
        message: "The Dotypos reservation has no table.",
      });
    }
    const recordBooking = yield* readRecordBooking(
      record,
      reservation.reservationDetails
    );

    const snapshots = yield* AccountingDocumentSnapshots;
    const snapshot =
      reservation.activePaymentAttemptId === null
        ? null
        : yield* snapshots.find(reservation.activePaymentAttemptId).pipe(
            Effect.mapError(
              (cause) =>
                new RestorationBookingUnreadable({
                  message: "The payment's accounting snapshot can't be loaded.",
                  cause,
                })
            )
          );

    if (snapshot) {
      const booking = yield* getCreationBooking({
        reservation,
        recordBooking,
        snapshot,
      });
      return {
        customerId: reservation.dotyposCustomerId,
        tableId,
        ...booking,
      } satisfies DotyposReservationBooking;
    }

    const changedFields = storedDetailChanges(
      reservation.reservationDetails,
      recordBooking
    );
    if (changedFields.length > 0) return yield* changed(changedFields);
    yield* Effect.logWarning(
      "Restoration booking taken from the Dotypos record: the paid attempt has no accounting snapshot"
    );
    return {
      customerId: reservation.dotyposCustomerId,
      tableId,
      startDate: temporalInstantToDate(recordBooking.held.startsAt),
      endDate: temporalInstantToDate(recordBooking.held.endsAt),
      seats: recordBooking.seats,
    } satisfies DotyposReservationBooking;
  },
  (effect, input) =>
    effect.pipe(
      Effect.annotateLogs({
        reservationId: input.reservation.id,
        reservationKind: input.reservation.reservationDetails.kind,
        paymentAttemptId: input.reservation.activePaymentAttemptId,
      })
    )
);
