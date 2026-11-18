import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { type Customer, DotyposReservationIdSchema } from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import {
  EmailConfigTag,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
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
  name: string,
  sent: { readonly count: number; readonly at?: Temporal.Instant } = {
    count: 0,
  }
): ReservationInvitee & { readonly email: InviteeEmail } => ({
  id: reservationInviteeIdSchema.make(`invitee-${name}`),
  reservationId,
  position: 0,
  email: InviteeEmail.make(testEmailAddress(`invitations-${name}`)),
  lastInvitationSentAt: sent.at ?? null,
  invitationSendCount: sent.count,
});

const run = async <A, E>(
  operation: (
    invitations: typeof ReservationInvitations.Service
  ) => Effect.Effect<A, E>,
  options: {
    readonly invitees: ReadonlyArray<ReservationInvitee>;
    readonly reservationState?: WorkspaceReservation["reservationState"];
    readonly claimed?: Option.Option<number>;
    readonly failSend?: true;
  }
) => {
  const sent: EmailMessage[] = [];
  const released: unknown[] = [];
  const result = await Effect.runPromise(
    ReservationInvitations.use(operation).pipe(
      Effect.result,
      Effect.provide(
        ReservationInvitations.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailServiceTag, {
                send: (message: EmailMessage) => {
                  sent.push(message);
                  if (options.failSend) {
                    return Effect.fail(
                      new EmailServiceError("synthetic delivery error")
                    );
                  }
                  return Effect.succeed({
                    id: EmailDeliveryIdSchema.make(`email-${sent.length}`),
                    status: "sent" as const,
                    provider: "test",
                    timestamp: new Date(),
                  });
                },
                sendBatch: () => Effect.die("unused"),
              }),
              Layer.succeed(EmailConfigTag, {
                provider: "console",
                defaultFrom: {
                  email: workspaceDefaultFromAddress,
                  name: "Deskohub Workspace",
                },
              }),
              Layer.mock(ReservationInvitees, {
                listForReservation: () => Effect.succeed(options.invitees),
                find: (_order, inviteeId) =>
                  Effect.succeed(
                    Option.fromNullishOr(
                      options.invitees.find((row) => row.id === inviteeId)
                    )
                  ),
                findBookedPeople: () =>
                  Effect.succeed(
                    Option.some({
                      contactAttends: true,
                      invitees: options.invitees.flatMap((row) =>
                        row.email === null ? [] : [{ ...row, email: row.email }]
                      ),
                    })
                  ),
                releaseFailedResend: (input) =>
                  Effect.sync(() => {
                    released.push(input);
                  }),
                claimResend: () =>
                  Effect.succeed(options.claimed ?? Option.some(2)),
              }),
              Layer.mock(WorkspaceReservationRepository, {
                findById: () =>
                  Effect.succeed({
                    id: reservationId,
                    reservationState: options.reservationState ?? "confirmed",
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
  return { result, sent, released };
};

describe("ReservationInvitations", () => {
  test("uses the initial invitation key and a personal link that grants invitee access only", async () => {
    const { sent } = await run(
      (invitations) =>
        invitations.deliverNotice({
          reservation,
          invitee: invitee("new"),
          kind: "invitation",
          noticeId: "notice-1",
        }),
      { invitees: [] }
    );
    expect(sent.map((message) => message.to)).toEqual([
      { email: testEmailAddress("invitations-new") },
    ]);
    expect(sent[0]?.idempotencyKey).toBe(
      "reservation-invitation:invitee-new:1"
    );
    expect(sent[0]?.html).toContain("invitationToken=");
    expect(sent[0]?.html).not.toContain("accessToken=");
    expect(sent[0]?.text).toContain("Alex Sample");
  });

  test("lists the booker and invitees for the booker's confirmation", async () => {
    const { result } = await run(
      (invitations) => invitations.bookerPeople(reservation),
      { invitees: [invitee("listed")] }
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: Option.some({
          contactName: "Alex Sample",
          invitees: [testEmailAddress("invitations-listed")],
        }),
      })
    );
  });

  test("resends under the claimed send number", async () => {
    const { result, sent } = await run(
      (invitations) =>
        invitations.resend({
          reservation,
          inviteeId: reservationInviteeIdSchema.make("invitee-again"),
        }),
      { invitees: [invitee("again", { count: 1 })], claimed: Option.some(2) }
    );
    expect(result._tag).toBe("Success");
    expect(sent[0]?.idempotencyKey).toBe(
      "reservation-invitation:invitee-again:2"
    );
  });

  test("refuses a resend during the cooldown or before confirmation", async () => {
    const sentAt = Temporal.Now.instant();
    const cooling = await run(
      (invitations) =>
        invitations.resend({
          reservation,
          inviteeId: reservationInviteeIdSchema.make("invitee-cooling"),
        }),
      {
        invitees: [invitee("cooling", { count: 1, at: sentAt })],
        claimed: Option.none(),
      }
    );
    const unconfirmed = await run(
      (invitations) =>
        invitations.resend({
          reservation,
          inviteeId: reservationInviteeIdSchema.make("invitee-cooling"),
        }),
      {
        invitees: [invitee("cooling", { count: 1, at: sentAt })],
        reservationState: "cancelled",
      }
    );

    expect(cooling.sent).toEqual([]);
    expect(cooling.result).toEqual(
      expect.objectContaining({
        failure: expect.objectContaining({
          refusal: {
            reason: "cooldown",
            retryAt: sentAt.add({ seconds: 60 }),
          },
        }),
      })
    );
    expect(unconfirmed.result).toEqual(
      expect.objectContaining({
        failure: expect.objectContaining({
          refusal: { reason: "not-confirmed" },
        }),
      })
    );
  });

  test("releases a failed resend so it can be retried with the same delivery key", async () => {
    const previousSentAt = Temporal.Instant.from("2026-11-10T10:00:00Z");
    const guest = invitee("retry", { count: 1, at: previousSentAt });
    const { result, sent, released } = await run(
      (invitations) => invitations.resend({ reservation, inviteeId: guest.id }),
      { invitees: [guest], failSend: true }
    );

    expect(result._tag).toBe("Failure");
    expect(new Set(sent.map(({ idempotencyKey }) => idempotencyKey))).toEqual(
      new Set([`reservation-invitation:${guest.id}:2`])
    );
    expect(released).toEqual([
      expect.objectContaining({
        inviteeId: guest.id,
        sendCount: 2,
        previousSentAt,
      }),
    ]);
  });

  test("keys a cancellation to its durable notice and omits a personal URL", async () => {
    const { sent } = await run(
      (invitations) =>
        invitations.deliverNotice({
          reservation,
          invitee: invitee("first"),
          kind: "cancellation",
          noticeId: "cancellation-1",
        }),
      { invitees: [] }
    );
    expect(sent[0]?.idempotencyKey).toBe(
      "reservation-invitee-cancelled:cancellation-1"
    );
    expect(sent[0]?.html).not.toContain("invitationToken=");
  });

  test.each([
    { restoredAccess: "link", codeIssued: false },
    { restoredAccess: "issued", codeIssued: true },
  ] as const)(
    "links a restored booking with access status $restoredAccess",
    async ({ restoredAccess, codeIssued }) => {
      const { sent } = await run(
        (invitations) =>
          invitations.deliverNotice({
            reservation,
            invitee: invitee("restored"),
            kind: "restoration",
            noticeId: "restoration-1",
            restoredAccess,
          }),
        { invitees: [] }
      );
      const newCodeNotice = m.officeInviteeRestorationNewAccessCode(
        {},
        { locale: "en-US" }
      );
      expect(sent[0]?.html).toContain("invitationToken=");
      expect(sent[0]?.text?.includes(newCodeNotice)).toBe(codeIssued);
    }
  );
});
