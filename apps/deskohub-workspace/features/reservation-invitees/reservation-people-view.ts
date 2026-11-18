import type { InviteeEmail } from "@/features/office/office-people";
import type { ReservationInviteeId } from "./reservation-invitee";

/** How long a booker waits before sending the same person's invitation again. */
export const invitationResendCooldown = { seconds: 60 } as const;

/** An invited person as the order's booker sees them. */
export interface ReservationInviteeView {
  readonly id: ReservationInviteeId;
  readonly email: InviteeEmail;
  /** When their latest invitation was sent; null before it was sent. */
  readonly invitationSentAt: Temporal.Instant | null;
  /**
   * When a resend is accepted again. Absent while one is accepted now, or
   * never will be, such as before the order is confirmed or once it is
   * cancelled.
   */
  readonly resendAvailableAt?: Temporal.Instant;
}

/**
 * Who is coming to a booked office, as its booker sees them: the contact
 * (the "You" row) while `contactAttends`, and the invited people in order.
 */
export interface ReservationPeopleView {
  readonly contactAttends: boolean;
  /** Whether the order is confirmed, so its invitations can be sent again. */
  readonly resendable: boolean;
  readonly invitees: ReadonlyArray<ReservationInviteeView>;
}

/** When a resend after one sent at `sentAt` is accepted. */
export const getInvitationResendAvailableAt = (sentAt: Temporal.Instant) =>
  sentAt.add(invitationResendCooldown);

/** The booker's view of a booked office's people at `now`. */
export const toReservationPeopleView = (
  people: {
    readonly contactAttends: boolean;
    readonly invitees: ReadonlyArray<{
      readonly id: ReservationInviteeId;
      readonly email: InviteeEmail;
      readonly lastInvitationSentAt: Temporal.Instant | null;
    }>;
  },
  context: { readonly now: Temporal.Instant; readonly resendable: boolean }
): ReservationPeopleView => ({
  contactAttends: people.contactAttends,
  resendable: context.resendable,
  invitees: people.invitees.map((invitee): ReservationInviteeView => {
    const availableAt =
      invitee.lastInvitationSentAt === null
        ? undefined
        : getInvitationResendAvailableAt(invitee.lastInvitationSentAt);
    return {
      id: invitee.id,
      email: invitee.email,
      invitationSentAt: invitee.lastInvitationSentAt,
      ...(context.resendable &&
        availableAt !== undefined &&
        Temporal.Instant.compare(availableAt, context.now) > 0 && {
          resendAvailableAt: availableAt,
        }),
    };
  }),
});
