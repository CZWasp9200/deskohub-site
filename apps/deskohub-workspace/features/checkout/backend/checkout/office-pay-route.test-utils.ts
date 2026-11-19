import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option, Schema } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import {
  buildOfficeReservationQuote,
  type OfficeReservationQuote,
} from "@/features/checkout/reservation-quote-office";
import type { Locale } from "@/features/i18n";
import { InviteeEmail } from "@/features/office/office-people";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { withCoworkProductFields } from "@/features/reservation/cowork-reservation-product";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import {
  getStoredWorkspaceReservationDetails,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { ReservationInvitees } from "@/features/reservation-invitees/backend/reservation-invitees.service";
import { reservationInviteeIdSchema } from "@/features/reservation-invitees/reservation-invitee";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import { buildSignedPayState, sealPayState } from "./pay-state";

/** A sealed office checkout with one stored guest and a changeable session. */
export const makeOfficePayRouteFixture = (
  options: {
    readonly seatOnly?: boolean;
    readonly startsOn?: string;
    readonly endsOn?: string;
    readonly unavailablePeople?: boolean;
    readonly customizeQuote?: (
      quote: OfficeReservationQuote
    ) => OfficeReservationQuote;
  } = {}
) => {
  const orderId = workspaceReservationIdSchema.make("office-order");
  const author = customerAccountIdSchema.make("office-author");
  const inviteeEmail = InviteeEmail.make(testEmailAddress("office-guest"));
  const reservation = Schema.decodeUnknownSync(
    normalizedOfficeReservationOrderSchema
  )({
    kind: "office",
    startsOn: options.startsOn ?? "2099-06-20",
    endsOn: options.endsOn ?? "2099-06-21",
    seats: options.seatOnly ? 3 : 2,
    name: "Ada Sample",
    email: testEmailAddress("office-booker"),
    phone: "+420777000111",
    billing: { purpose: "personal", invoice: "none" },
  });
  const holdExpiresAt = instantStringSchema.make("2099-06-01T10:08:00Z");
  const row = withCoworkProductFields({
    id: orderId,
    authorAccountId: author,
    officeContactAttends: options.seatOnly ? null : true,
    reservationDetails: getStoredWorkspaceReservationDetails(reservation),
    reservationState: "held",
    paymentState: "not_started",
    dotyposReservationId: DotyposReservationIdSchema.make("synthetic-office"),
    reservationHoldExpiresAt: Temporal.Instant.from(holdExpiresAt),
  } satisfies Partial<WorkspaceReservation>);
  let viewer = author;
  const services = Layer.mergeAll(
    TestSealedStateKeys,
    Layer.mock(WorkspaceReservationRepository, {
      // The guarded lookup reads only the held order fields above.
      findById: (id) =>
        Effect.succeed(id === orderId ? (row as WorkspaceReservation) : null),
    }),
    Layer.mock(CustomerAuthentication, {
      currentUser: Effect.sync(() => ({
        ...testSessionProfile,
        accountId: viewer,
        email: reservation.email,
        deletionRequested: false,
      })),
    }),
    Layer.mock(ReservationInvitees, {
      findBookedPeople: ({ id, officeContactAttends, seats }) =>
        Effect.succeed(
          id === orderId &&
            officeContactAttends &&
            seats === 2 &&
            !options.unavailablePeople
            ? Option.some({
                contactAttends: true,
                invitees: [
                  {
                    id: reservationInviteeIdSchema.make("office-invitee"),
                    reservationId: orderId,
                    position: 0,
                    email: inviteeEmail,
                    lastInvitationSentAt: null,
                    invitationSendCount: 0,
                  },
                ],
              })
            : Option.none()
        ),
    })
  );
  const seal = (locale: Locale) =>
    Effect.gen(function* () {
      const quote = yield* buildOfficeReservationQuote(reservation);
      const state = yield* buildSignedPayState({
        locale,
        reservation,
        quote: options.customizeQuote?.(quote) ?? quote,
        orderId,
        bookedAt: instantStringSchema.make("2026-06-01T09:58:00Z"),
        holdExpiresAt,
        checkoutSessionId: checkoutSessionIdSchema.make("office-session"),
      });
      return yield* sealPayState(state);
    }).pipe(Effect.provide(TestSealedStateKeys), Effect.runPromise);

  return {
    inviteeEmail,
    reservation,
    seal,
    services,
    signInAsAnotherAccount: () => {
      viewer = customerAccountIdSchema.make("another-account");
    },
  };
};
