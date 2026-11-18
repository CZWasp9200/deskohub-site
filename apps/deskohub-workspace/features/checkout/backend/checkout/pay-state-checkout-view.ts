import { Effect, Layer, Option } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type {
  CheckoutSummary,
  CheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import type {
  CanonicalPromotionCode,
  DiscountId,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import {
  getEarlyPerformanceRequestRequiredAt,
  isEarlyPerformanceRequestRequired,
} from "@/features/legal/early-performance";
import type { InviteeEmail } from "@/features/office/office-people";
import { isReservationSupersedable } from "@/features/reservation/backend/reservation-supersession";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type BookedOfficePeople,
  getBookedPeopleQuery,
  ReservationInvitees,
} from "@/features/reservation-invitees/backend/reservation-invitees.service";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  currentInstant,
  type Instant,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import { PayState, type PayStateWithHoldExpiry } from "./pay-state";

/**
 * What a client shows for one signed Pay state: the order, its summary, a
 * pending price review, and whether submitting it needs the early-performance
 * request. The Pay page computes the same facts from the same state.
 */
export type PayStateCheckoutView = {
  readonly orderId: WorkspaceReservationId;
  /** The instant the Pay state token stops being accepted. */
  readonly expiresAt: string;
  /** The instant the reservation hold ends; reissuing the token keeps it. */
  readonly holdExpiresAt: Instant;
  readonly summary: CheckoutSummary;
  /** The entered code the price includes, with its summary discount's id. */
  readonly appliedDiscountCode?: {
    readonly code: CanonicalPromotionCode;
    readonly discountId: DiscountId;
  };
  /** Set while the customer still has to accept a price change. */
  readonly changedKeys: CheckoutSummaryChangedKeys | undefined;
  readonly earlyPerformanceConsent: {
    readonly required: boolean;
    /** From this instant on, submitting needs the early-performance request. */
    readonly requiredFrom: string;
  };
  /**
   * Who is coming to an office booked with a people list; absent for any
   * other order. Read from the order's invitee rows, since the Pay state
   * never carries an invitee's address.
   */
  readonly people?: CheckoutOfficePeople;
};

/** Who is coming to an office order under review: the contact and invitees. */
export type CheckoutOfficePeople = {
  readonly contactAttends: boolean;
  readonly invitees: ReadonlyArray<InviteeEmail>;
};

const toCheckoutOfficePeople = (
  people: BookedOfficePeople
): CheckoutOfficePeople => ({
  contactAttends: people.contactAttends,
  invitees: people.invitees.map(({ email }) => email),
});

/**
 * Who is coming to a Pay state's order, when it is an office booked with a
 * people list.
 */
export const findCheckoutOfficePeople = Effect.fn(
  "payState.findCheckoutOfficePeople"
)(function* (orderId: WorkspaceReservationId) {
  const reservation = yield* WorkspaceReservationRepository.pipe(
    Effect.flatMap((reservations) => reservations.findById(orderId))
  );
  if (!reservation) return Option.none<CheckoutOfficePeople>();
  const booked = yield* ReservationInvitees.pipe(
    Effect.flatMap((invitees) =>
      invitees.findBookedPeople(getBookedPeopleQuery(reservation))
    )
  );
  return Option.map(booked, toCheckoutOfficePeople);
});

/**
 * Reads the list from a held office when the Pay token belongs to this
 * visitor. An order without an account author can be recovered with its
 * existing signed Pay token.
 */
export const findCheckoutOfficePeopleForVisitor = Effect.fn(
  "payState.findCheckoutOfficePeopleForVisitor"
)(function* (input: {
  readonly payStateToken: string;
  readonly locale: Locale;
}) {
  const state = yield* PayState.open(input.payStateToken, {
    locale: input.locale,
  });
  if (state.reservation.kind !== "office")
    return Option.none<CheckoutOfficePeople>();

  const reservations = yield* WorkspaceReservationRepository;
  const reservation = yield* reservations.findById(state.orderId);
  if (
    !reservation ||
    !isReservationSupersedable(reservation) ||
    !reservation.reservationHoldExpiresAt
  ) {
    return Option.none<CheckoutOfficePeople>();
  }
  const now = yield* currentInstant;
  if (
    Temporal.Instant.compare(reservation.reservationHoldExpiresAt, now) <= 0
  ) {
    return Option.none<CheckoutOfficePeople>();
  }
  if (reservation.authorAccountId !== null) {
    const authentication = yield* CustomerAuthentication;
    const session = yield* authentication.currentUser;
    if (
      session?.accountId !== reservation.authorAccountId ||
      session.deletionRequested
    ) {
      return Option.none<CheckoutOfficePeople>();
    }
  }

  const invitees = yield* ReservationInvitees;
  const booked = yield* invitees.findBookedPeople(
    getBookedPeopleQuery(reservation)
  );
  return Option.map(booked, toCheckoutOfficePeople);
});

export const checkoutOfficePeopleForVisitorServices = Layer.mergeAll(
  CustomerAuthentication.Default,
  ReservationInvitees.Default,
  SealedStateKeys.Default,
  WorkspaceReservationRepository.Live
);

export const getPayStateCheckoutView = (
  state: PayStateWithHoldExpiry,
  now: Temporal.Instant
): PayStateCheckoutView => ({
  orderId: state.orderId,
  expiresAt: PayState.expiresAt(state),
  holdExpiresAt: state.holdExpiresAt,
  summary: PayState.summary(state),
  ...(state.submittedCode !== undefined && {
    appliedDiscountCode: {
      code: state.submittedCode,
      discountId: state.submittedCodeDiscountId,
    },
  }),
  changedKeys: state.changedKeys,
  earlyPerformanceConsent: {
    required: isEarlyPerformanceRequestRequired({
      reservation: state.reservation,
      contractAt: now,
    }),
    requiredFrom: temporalInstantToIsoString(
      getEarlyPerformanceRequestRequiredAt(state.reservation)
    ),
  },
});
