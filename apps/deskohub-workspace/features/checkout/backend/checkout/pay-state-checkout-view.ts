import { Effect, Option } from "effect";
import type {
  CheckoutSummary,
  CheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import type {
  CanonicalPromotionCode,
  DiscountId,
} from "@/features/discounts/contracts";
import {
  getEarlyPerformanceRequestRequiredAt,
  isEarlyPerformanceRequestRequired,
} from "@/features/legal/early-performance";
import type { InviteeEmail } from "@/features/office/office-people";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  getBookedPeopleQuery,
  ReservationInvitees,
} from "@/features/reservation-invitees/backend/reservation-invitees.service";
import {
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
   * never carries an invitee's address (`withCheckoutOfficePeople`).
   */
  readonly people?: CheckoutOfficePeople;
};

/** Who is coming to an office order under review: the contact and invitees. */
export type CheckoutOfficePeople = {
  readonly contactAttends: boolean;
  readonly invitees: ReadonlyArray<InviteeEmail>;
};

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
  return Option.map(
    booked,
    (people): CheckoutOfficePeople => ({
      contactAttends: people.contactAttends,
      invitees: people.invitees.map(({ email }) => email),
    })
  );
});

/** The view with who is coming to its order, when that is an office. */
export const withCheckoutOfficePeople = (view: PayStateCheckoutView) =>
  findCheckoutOfficePeople(view.orderId).pipe(
    Effect.map(
      (people): PayStateCheckoutView =>
        Option.match(people, {
          onNone: () => view,
          onSome: (found) => ({ ...view, people: found }),
        })
    )
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
