import "@/shared/polyfills/temporal";

import {
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Option } from "effect";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import type { CoworkReservationDetails } from "@/features/reservation/cowork-reservation";
import {
  type CoworkStay,
  getBookedCoworkStay,
  overnightCoworkStayTier,
} from "@/features/reservation/cowork-stay";
import { getMeetingRoomEarlySetupField } from "@/features/reservation/meeting-room-early-setup";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import type { OfficeReservationDetails } from "@/features/reservation/office-reservation";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationInterval } from "@/features/reservation/reservation-interval";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  plainDateStringSchema,
  temporalInstantToDate,
} from "@/shared/utils/temporal";
import {
  createWorkspaceDotyposReservation,
  noteNamesPaymentOrder,
} from "./dotypos-reservation.adapter";
import type { WorkspaceTableAssignmentReservation } from "./workspace-table-assignment.service";

/** An order's accepted reservation, rebuilt for a new Dotypos reservation. */
export type RecreatedReservation = {
  readonly checkoutDetails: CheckoutDetails;
  readonly reservation: WorkspaceTableAssignmentReservation;
};

type CoworkSnapshot = Extract<
  AccountingDocumentSnapshot,
  { readonly reservation: { readonly kind: "cowork" } }
>;
type MeetingRoomSnapshot = Extract<
  AccountingDocumentSnapshot,
  { readonly reservation: { readonly kind: "meeting-room" } }
>;
type OfficeSnapshot = Extract<
  AccountingDocumentSnapshot,
  { readonly reservation: { readonly kind: "office" } }
>;

const isCoworkSnapshot = (
  snapshot: AccountingDocumentSnapshot
): snapshot is CoworkSnapshot => snapshot.reservation.kind === "cowork";
const isMeetingRoomSnapshot = (
  snapshot: AccountingDocumentSnapshot
): snapshot is MeetingRoomSnapshot =>
  snapshot.reservation.kind === "meeting-room";
const isOfficeSnapshot = (
  snapshot: AccountingDocumentSnapshot
): snapshot is OfficeSnapshot => snapshot.reservation.kind === "office";

/**
 * Rebuilds the order's reservation and checkout details from its stored
 * details and the accepted accounting snapshot of its paid attempt: the
 * reservation exactly as the customer accepted and paid it. Null when the
 * snapshot is for another reservation kind than the order.
 */
export const rebuildAcceptedReservation = (
  row: WorkspaceReservation,
  snapshot: AccountingDocumentSnapshot,
  /** The Reserved Desk stay {@link findOrderCoworkStay} read; Workspace stores none. */
  coworkStay: CoworkStay | undefined
): RecreatedReservation | null => {
  if (row.reservationDetails.kind !== snapshot.reservation.kind) return null;

  if (isCoworkSnapshot(snapshot)) {
    if (row.reservationDetails.kind !== "cowork") return null;
    const reservation: CoworkReservationDetails = {
      ...row.reservationDetails,
      date: snapshot.reservation.date,
      ...(coworkStay === "overnight" && { stay: coworkStay }),
    };
    return {
      reservation,
      checkoutDetails: {
        locale: snapshot.locale,
        legal: {},
        reservation,
        payment: {
          ...snapshot.quote.payment,
          summary: getCoworkCheckoutSummary(reservation, snapshot.quote),
        },
      },
    };
  }
  if (isMeetingRoomSnapshot(snapshot)) {
    if (row.reservationDetails.kind !== "meeting-room") return null;
    const item = snapshot.quote.items[0];
    const reservation: MeetingRoomReservationDetails = {
      kind: "meeting-room",
      duration: item.duration,
      reservationDate: plainDateStringSchema.make(
        Temporal.Instant.from(snapshot.reservation.startsAt)
          .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
          .toPlainDate()
          .toString()
      ),
      startsAt: snapshot.reservation.startsAt,
      endsAt: snapshot.reservation.endsAt,
      ...getMeetingRoomEarlySetupField(row.reservationDetails),
    };
    return {
      reservation,
      checkoutDetails: {
        locale: snapshot.locale,
        legal: {},
        reservation,
        payment: {
          ...snapshot.quote.payment,
          items: snapshot.quote.items,
        },
      },
    };
  }
  if (isOfficeSnapshot(snapshot)) {
    const reservation: OfficeReservationDetails = snapshot.reservation;
    return {
      reservation,
      checkoutDetails: {
        locale: snapshot.locale,
        legal: {},
        reservation,
        payment: {
          ...snapshot.quote.payment,
          items: snapshot.quote.items,
        },
      },
    };
  }
  return null;
};

/**
 * The stay of the order's Reserved Desk, which Workspace doesn't store, from
 * the bounds of one of the order's Dotypos reservations. Undefined for other
 * reservations and when the bounds can't be read, which rebuilds a day stay.
 */
export const findOrderCoworkStay = Effect.fnUntraced(function* (input: {
  readonly order: WorkspaceReservation;
  readonly dotyposReservationId: DotyposReservationId;
}) {
  const details = input.order.reservationDetails;
  if (
    details.kind !== "cowork" ||
    details.entryTier !== overnightCoworkStayTier
  ) {
    return undefined;
  }
  const dotypos = yield* DotyposService;
  const booked = yield* dotypos.getReservationWithoutCustomer(
    input.dotyposReservationId
  );
  return Option.match(decodeBookedReservation(booked).interval, {
    onNone: () => undefined,
    onSome: (interval) =>
      getBookedCoworkStay({ tier: details.entryTier, interval }),
  });
});

/**
 * The order's active (NEW or CONFIRMED) Dotypos reservations overlapping the
 * interval. Every Dotypos reservation an order creates, its original booking
 * hold and each one recreated for it, names the order in its note.
 */
export const findOrderDotyposReservations = Effect.fnUntraced(
  function* (input: {
    readonly orderId: WorkspaceReservationId;
    readonly interval: Pick<ReservationInterval, "startsAt" | "endsAt">;
  }) {
    const dotypos = yield* DotyposService;
    return (yield* dotypos.listActiveReservationsOverlapping({
      startDate: temporalInstantToDate(
        Temporal.Instant.from(input.interval.startsAt)
      ),
      endDate: temporalInstantToDate(
        Temporal.Instant.from(input.interval.endsAt)
      ),
    })).filter((candidate) =>
      noteNamesPaymentOrder(candidate.note, input.orderId)
    );
  }
);

/** The order's Dotypos reservation a resume or creation settled on. */
export type OrderDotyposReservation = {
  readonly id: DotyposReservationId;
  /** The resumed reservation's status, or the status it was created with. */
  readonly status: DotyposReservation["status"];
  /** True when an earlier run's reservation was resumed instead of created. */
  readonly resumed: boolean;
};

/**
 * Resumes the first of the order's `found` Dotypos reservations, which an
 * interrupted earlier run created after the availability check and table
 * assignment, and otherwise creates one with `status` after both. `status`
 * applies to creation only: the first found reservation is resumed whatever
 * its status, so callers pass only the reservations they may resume and
 * decide beforehand what more than one means. Null when the workspace or a
 * table is no longer available for the reservation.
 */
export const resumeOrCreateOrderDotyposReservation = Effect.fnUntraced(
  function* (input: {
    readonly order: WorkspaceReservation;
    readonly recreated: RecreatedReservation;
    readonly found: readonly DotyposReservation[];
    readonly status: "NEW" | "CONFIRMED";
  }) {
    const resumed = input.found[0];
    if (resumed) {
      return {
        id: resumed.id,
        status: resumed.status,
        resumed: true,
      } satisfies OrderDotyposReservation;
    }
    const availability = yield* WorkspaceAvailabilityService;
    const { order, recreated } = input;
    return yield* availability.ensureAvailable(recreated.reservation).pipe(
      Effect.andThen(
        createWorkspaceDotyposReservation({
          paymentOrderId: order.id,
          dotyposCustomerId: order.dotyposCustomerId,
          checkoutDetails: recreated.checkoutDetails,
          reservation: recreated.reservation,
          status: input.status,
        })
      ),
      Effect.map((created): OrderDotyposReservation | null => ({
        id: created.id,
        status: input.status,
        resumed: false,
      })),
      Effect.catchTags({
        WorkspaceTableUnavailableError: () => Effect.succeed(null),
        TableAssignmentUnavailableError: () => Effect.succeed(null),
      })
    );
  }
);
