import { Schema } from "effect";

export const reservationAccessTokenQueryParam = "accessToken" as const;

export const reservationAccessTokenSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(4096)
)
  .pipe(Schema.brand("ReservationAccessToken"))
  .annotate({
    identifier: "ReservationAccessToken",
    description: "Signed capability for a protected reservation page.",
  });
export type ReservationAccessToken = typeof reservationAccessTokenSchema.Type;

/**
 * The query parameter of an invited person's personal link to a
 * reservation's access page. It opens only that page, and only while the
 * person is still invited.
 */
export const reservationInvitationTokenQueryParam = "invitationToken" as const;

export const reservationInvitationTokenSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(4096)
)
  .pipe(Schema.brand("ReservationInvitationToken"))
  .annotate({
    identifier: "ReservationInvitationToken",
    description:
      "Signed capability of one invited person for a reservation's access page.",
  });
export type ReservationInvitationToken =
  typeof reservationInvitationTokenSchema.Type;
