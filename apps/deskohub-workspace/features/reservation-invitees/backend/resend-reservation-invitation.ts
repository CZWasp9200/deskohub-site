import { Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import type { Locale } from "@/features/i18n";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import type { ReservationInviteeId } from "../reservation-invitee";
import {
  InvitationResendRefused,
  ReservationInvitations,
} from "./reservation-invitations.service";
import { ReservationInvitees } from "./reservation-invitees.service";

export const resendReservationInvitationServices = Layer.mergeAll(
  WorkspaceReservationRepository.Default.pipe(
    Layer.provide(WorkspaceDatabase.Default)
  ),
  WorkspaceReservationService.Live,
  WorkspaceDatabaseAdvisoryLock.Default,
  ReservationInvitees.Default,
  ReservationInvitations.Live.pipe(Layer.provide(WorkspaceEmailLayer))
);

export const resendAuthorizedReservationInvitation = Effect.fn(
  "reservationInvitations.resendAuthorized"
)(function* (input: {
  readonly orderId: WorkspaceReservationId;
  readonly inviteeId: ReservationInviteeId;
  readonly locale: Locale;
  readonly accessCookie?: string;
}) {
  const { orderId, inviteeId, locale, accessCookie } = input;
  const authorization = yield* ReservationAuthorizationService;
  if (
    !(yield* authorization.authorize({
      orderId,
      locale,
      accessCookie,
      permission: "resend-invitation",
    }))
  ) {
    return yield* new InvitationResendRefused({
      refusal: { reason: "not-found" },
    });
  }

  return yield* WorkspaceLockSections.reservationInviteeNotices(orderId)(
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const stored = yield* reservations.findById(orderId);
      if (stored?.reservationDetails.kind !== "office") {
        return yield* new InvitationResendRefused({
          refusal: { reason: "not-found" },
        });
      }
      const invitees = yield* ReservationInvitees;
      const invitee = yield* invitees.find(orderId, inviteeId);
      if (Option.isNone(invitee) || invitee.value.email === null) {
        return yield* new InvitationResendRefused({
          refusal: { reason: "not-found" },
        });
      }
      if (
        stored.paymentState !== "paid" ||
        stored.reservationState !== "confirmed"
      ) {
        return yield* new InvitationResendRefused({
          refusal: { reason: "not-confirmed" },
        });
      }

      const workspace = yield* WorkspaceReservationService;
      const reservation = yield* workspace.getReservation(orderId);
      if (reservation.providerStatus !== "CONFIRMED") {
        return yield* new InvitationResendRefused({
          refusal: { reason: "not-confirmed" },
        });
      }
      const invitations = yield* ReservationInvitations;
      return yield* invitations.resend({ reservation, inviteeId });
    }).pipe(Effect.timeout("8 seconds"))
  );
});
