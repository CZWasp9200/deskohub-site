import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { InviteeEmail } from "@/features/office/office-people";
import { reservationInviteeIdSchema } from "./reservation-invitee";
import { toReservationPeopleView } from "./reservation-people-view";

const sentAt = Temporal.Instant.from("2030-03-01T10:00:00Z");
const people = {
  contactAttends: true,
  invitees: [
    {
      id: reservationInviteeIdSchema.make("invitee-sent"),
      email: InviteeEmail.make(testEmailAddress("people-view-sent")),
      lastInvitationSentAt: sentAt,
    },
    {
      id: reservationInviteeIdSchema.make("invitee-unsent"),
      email: InviteeEmail.make(testEmailAddress("people-view-unsent")),
      lastInvitationSentAt: null,
    },
  ],
};

describe("toReservationPeopleView", () => {
  test("names when a confirmed order accepts a resend again", () => {
    const view = toReservationPeopleView(people, {
      now: sentAt.add({ seconds: 30 }),
      resendable: true,
    });
    expect(view.invitees.map((invitee) => invitee.resendAvailableAt)).toEqual([
      sentAt.add({ seconds: 60 }),
      undefined,
    ]);
  });

  test("drops the wait once the cooldown passed or the order can't resend", () => {
    const later = toReservationPeopleView(people, {
      now: sentAt.add({ seconds: 60 }),
      resendable: true,
    });
    const cancelled = toReservationPeopleView(people, {
      now: sentAt.add({ seconds: 30 }),
      resendable: false,
    });
    expect(later.invitees[0]?.resendAvailableAt).toBeUndefined();
    expect(cancelled.invitees[0]?.resendAvailableAt).toBeUndefined();
    expect(cancelled.resendable).toBe(false);
  });
});
