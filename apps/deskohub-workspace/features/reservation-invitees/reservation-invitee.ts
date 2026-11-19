import { Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export const reservationInviteeIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("ReservationInviteeId")
).annotate({
  identifier: "ReservationInviteeId",
  description:
    "Opaque identifier for a person a booker invited to a reservation by email.",
});
export type ReservationInviteeId = typeof reservationInviteeIdSchema.Type;

/**
 * Names the key that encrypted an invitee's address and derived its lookup
 * key, so rows written before a key rotation stay readable: the kid of the
 * `CHECKOUT_PAY_STATE_KEYS` entry both keys derive from.
 */
export const reservationInviteeKeyIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("ReservationInviteeKeyId")
);
export type ReservationInviteeKeyId = typeof reservationInviteeKeyIdSchema.Type;

/** How long an invitee's address outlives the reservation's access. */
const reservationInviteeRetentionDays = 30;

/**
 * When an invitee's address is due for deletion: 30 Prague calendar days
 * after `accessEndsAt`, the end of the reservation's access window. The
 * retention purge also honors a later access end recorded after the row was
 * written.
 */
export const getReservationInviteeRetainUntil = (
  accessEndsAt: Temporal.Instant
): Temporal.Instant =>
  accessEndsAt
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .add({ days: reservationInviteeRetentionDays })
    .toInstant();
