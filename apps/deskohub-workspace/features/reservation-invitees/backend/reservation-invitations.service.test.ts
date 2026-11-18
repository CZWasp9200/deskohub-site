import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { type Customer, DotyposReservationIdSchema } from "@deskohub/dotypos";
import { EmailConfigTag } from "@deskohub/email/backend/service";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { m } from "@/features/i18n";
import { InviteeEmail } from "@/features/office/office-people";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationInviteeIdSchema } from "@/features/reservation-invitees/reservation-invitee";
import { workspaceDefaultFromAddress } from "@/shared/backend/config/email.config";
import { ReservationInvitations } from "./reservation-invitations.service";
import {
  type ReservationInvitee,
  ReservationInvitees,
} from "./reservation-invitees.service";

const reservationId = workspaceReservationIdSchema.make("office-order");
const booker: Customer = {
  _cloudId: "booker-id",
  firstName: "Alex",
  lastName: "Sample",
  companyName: null,
  email: testEmailAddress("invitations-booker"),
  phone: null,
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};
const reservation = {
  id: reservationId,
  dotyposCustomerId: "booker-id",
  authorAccountId: null,
  dotyposReservationId: DotyposReservationIdSchema.make(
    "dotypos-reservation-id"
  ),
  reservationDetails: { kind: "office", seats: 3, dayCount: 1 },
  locale: "en-US",
  customer: booker,
  reservedFrom: Temporal.Instant.from("2026-11-17T23:00:00Z"),
  reservedUntil: Temporal.Instant.from("2026-11-18T23:00:00Z"),
  providerStatus: "CONFIRMED",
  seats: 3,
  placement: {},
} satisfies WorkspaceReservationDetails;

const invitee = (
  name: string
): ReservationInvitee & { readonly email: InviteeEmail } => ({
  id: reservationInviteeIdSchema.make(`invitee-${name}`),
  reservationId,
  position: 0,
  email: InviteeEmail.make(testEmailAddress(`invitations-${name}`)),
  lastInvitationSentAt: null,
  invitationSendCount: 0,
});

const run = <A, E>(
  operation: (
    invitations: typeof ReservationInvitations.Service
  ) => Effect.Effect<A, E>,
  invitees: ReadonlyArray<ReturnType<typeof invitee>> = []
) =>
  Effect.runPromise(
    ReservationInvitations.use(operation).pipe(
      Effect.provide(
        ReservationInvitations.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailConfigTag, {
                provider: "console",
                defaultFrom: {
                  email: workspaceDefaultFromAddress,
                  name: "Deskohub Workspace",
                },
              }),
              Layer.mock(ReservationInvitees, {
                findBookedPeople: () =>
                  Effect.succeed(
                    Option.some({ contactAttends: true, invitees })
                  ),
              }),
              Layer.mock(WorkspaceReservationRepository, {
                findById: () =>
                  Effect.succeed({
                    id: reservationId,
                    reservationState: "confirmed",
                    officeContactAttends: true,
                    reservationDetails: reservation.reservationDetails,
                    reservationCancelledAt: Temporal.Instant.from(
                      "2026-11-10T10:00:00Z"
                    ),
                  } as WorkspaceReservation),
              })
            )
          )
        )
      )
    )
  );

describe("ReservationInvitations", () => {
  test("uses the initial invitation key and a personal link that grants invitee access only", async () => {
    const message = await run((invitations) =>
      invitations.renderNotice({
        reservation,
        invitee: invitee("new"),
        kind: "invitation",
        noticeId: "notice-1",
      })
    );
    expect(message.to).toEqual({ email: testEmailAddress("invitations-new") });
    expect(message.idempotencyKey).toBe("reservation-invitation:notice-1");
    expect(message.html).toContain("invitationToken=");
    expect(message.html).not.toContain("accessToken=");
    expect(message.text).toContain("Alex Sample");
  });

  test("lists the booker and invitees for the booker's confirmation", async () => {
    expect(
      await run(
        (invitations) => invitations.bookerPeople(reservation),
        [invitee("listed")]
      )
    ).toEqual(
      Option.some({
        contactName: "Alex Sample",
        invitees: [testEmailAddress("invitations-listed")],
      })
    );
  });

  test("keys a cancellation to its durable notice and omits a personal URL", async () => {
    const message = await run((invitations) =>
      invitations.renderNotice({
        reservation,
        invitee: invitee("first"),
        kind: "cancellation",
        noticeId: "cancellation-1",
      })
    );
    expect(message.idempotencyKey).toBe(
      "reservation-invitee-cancelled:cancellation-1"
    );
    expect(message.html).not.toContain("invitationToken=");
  });

  test.each([
    { restoredAccess: "link", codeIssued: false },
    { restoredAccess: "issued", codeIssued: true },
  ] as const)(
    "links a restored booking with access status $restoredAccess",
    async ({ restoredAccess, codeIssued }) => {
      const message = await run((invitations) =>
        invitations.renderNotice({
          reservation,
          invitee: invitee("restored"),
          kind: "restoration",
          noticeId: "restoration-1",
          restoredAccess,
        })
      );
      const newCodeNotice = m.officeInviteeRestorationNewAccessCode(
        {},
        { locale: "en-US" }
      );
      expect(message.html).toContain("invitationToken=");
      expect(message.text?.includes(newCodeNotice)).toBe(codeIssued);
    }
  );
});
