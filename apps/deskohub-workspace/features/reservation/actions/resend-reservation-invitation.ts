"use server";

import { Effect, Layer, Schema } from "effect";
import { readReservationAccessCookie } from "@/features/reservation/backend/reservation-access-cookie";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  resendAuthorizedReservationInvitation,
  resendReservationInvitationServices,
} from "@/features/reservation-invitees/backend/resend-reservation-invitation";
import { reservationInviteeIdSchema } from "@/features/reservation-invitees/reservation-invitee";
import { getRequestCookies } from "@/shared/backend/utils/request-cookies";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

type ResendOutcome =
  | { readonly status: "sent"; readonly resendAvailableAt: string }
  | { readonly status: "cooldown"; readonly retryAt: string }
  | { readonly status: "failed" };

const resend = defineWorkspaceAction(
  {
    operation: "reservation.resend-invitation",
    logInput: false,
    schema: Schema.toStandardSchemaV1(
      Schema.Struct({
        orderId: workspaceReservationIdSchema,
        inviteeId: reservationInviteeIdSchema,
      })
    ),
  },
  Effect.fnUntraced(
    function* ({ orderId, inviteeId }, { locale }) {
      const cookies = yield* getRequestCookies;
      return yield* resendAuthorizedReservationInvitation({
        orderId,
        inviteeId,
        locale,
        accessCookie: readReservationAccessCookie(cookies, orderId),
      });
    },
    (result) =>
      result.pipe(
        Effect.provide(
          Layer.mergeAll(
            resendReservationInvitationServices,
            ReservationAuthorizationService.Live
          )
        ),
        Effect.map(
          ({ resendAvailableAt }): ResendOutcome => ({
            status: "sent",
            resendAvailableAt: resendAvailableAt.toString(),
          })
        ),
        Effect.catchTag("InvitationResendRefused", ({ refusal }) =>
          Effect.succeed<ResendOutcome>(
            refusal.reason === "cooldown"
              ? { status: "cooldown", retryAt: refusal.retryAt.toString() }
              : { status: "failed" }
          )
        ),
        Effect.catch(() =>
          Effect.logWarning("Reservation invitation resend failed", {
            code: "reservation.invitation.resend-failed",
          }).pipe(Effect.as<ResendOutcome>({ status: "failed" }))
        )
      )
  )
);

/** The timestamps cross the Server Action boundary as ISO strings. */
export const resendReservationInvitation = async (
  input: Parameters<typeof resend>[0]
): Promise<ResendOutcome> => {
  const result = await resend(input);
  return result?.data ?? { status: "failed" };
};
