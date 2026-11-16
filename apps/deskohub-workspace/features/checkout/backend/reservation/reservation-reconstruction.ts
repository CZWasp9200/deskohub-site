import "@/shared/polyfills/temporal";

import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import type { CoworkReservationDetails } from "@/features/reservation/cowork-reservation";
import { getMeetingRoomEarlySetupField } from "@/features/reservation/meeting-room-early-setup";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import type { OfficeReservationDetails } from "@/features/reservation/office-reservation";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import type { WorkspaceTableAssignmentReservation } from "./workspace-table-assignment.service";

/**
 * The reservation a payment accepted, rebuilt from its accounting snapshot:
 * what Workspace booked in Dotypos when the reservation was created.
 */
export type ReconstructedReservation = {
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
 * Rebuilds the reservation from the accounting snapshot of the payment that
 * accepted it, with the product intent the reservation stores. Null when the
 * snapshot is of another reservation kind than the stored details.
 */
export const reconstructReservation = (
  row: Pick<WorkspaceReservation, "reservationDetails">,
  snapshot: AccountingDocumentSnapshot
): ReconstructedReservation | null => {
  if (row.reservationDetails.kind !== snapshot.reservation.kind) return null;

  if (isCoworkSnapshot(snapshot)) {
    if (row.reservationDetails.kind !== "cowork") return null;
    const reservation: CoworkReservationDetails = {
      ...row.reservationDetails,
      date: snapshot.reservation.date,
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
