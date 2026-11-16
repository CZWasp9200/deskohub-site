import { Effect } from "effect";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type Instant,
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import {
  openPayState,
  type PayStateWithHoldExpiry,
  type SignedPayState,
} from "./pay-state";
import {
  type PayableReservation,
  PayableReservationUnavailableError,
} from "./payable-reservation.service";

/** A stored hold deadline as the Pay state signs it. */
export const toPayStateHoldExpiresAt = (
  reservationHoldExpiresAt: Temporal.Instant
): Instant =>
  instantStringSchema.make(
    temporalInstantToIsoString(reservationHoldExpiresAt)
  );

/**
 * The hold deadline an opened Pay state carries forward: its signed claim, or
 * for a state signed before the claim existed, its reservation's stored
 * deadline. Never the token's own expiry.
 */
export const getPayStateHoldExpiresAt = (
  state: Pick<SignedPayState, "holdExpiresAt">,
  reservation: Pick<PayableReservation, "reservationHoldExpiresAt">
): Instant =>
  state.holdExpiresAt ??
  toPayStateHoldExpiresAt(reservation.reservationHoldExpiresAt);

/** `state` with the hold deadline `getPayStateHoldExpiresAt` gives it. */
export const withPayStateHoldExpiry = <State extends SignedPayState>(
  state: State,
  reservation: Pick<PayableReservation, "reservationHoldExpiresAt">
): State & { readonly holdExpiresAt: Instant } => ({
  ...state,
  holdExpiresAt: getPayStateHoldExpiresAt(state, reservation),
});

/**
 * `withPayStateHoldExpiry` for a caller that hasn't loaded the reservation:
 * it reads the stored deadline only when the state was signed without one.
 */
export const loadPayStateHoldExpiry = Effect.fn("payState.loadHoldExpiry")(
  function* (state: SignedPayState) {
    const { holdExpiresAt } = state;
    if (holdExpiresAt !== undefined) {
      const held: PayStateWithHoldExpiry = { ...state, holdExpiresAt };
      return held;
    }

    const reservations = yield* WorkspaceReservationRepository;
    const reservation = yield* reservations.findById(state.orderId);
    if (!reservation) {
      return yield* new PayableReservationUnavailableError({
        orderId: state.orderId,
        reason: "missing_reservation",
      });
    }
    const { reservationHoldExpiresAt } = reservation;
    if (reservationHoldExpiresAt === null) {
      return yield* new PayableReservationUnavailableError({
        orderId: state.orderId,
        reason: "not_held",
      });
    }
    return withPayStateHoldExpiry(state, { reservationHoldExpiresAt });
  }
);

/** Opens a Pay state token with its hold deadline. */
export const openPayStateWithHoldExpiry = Effect.fn("payState.openHeld")(
  (token: string) =>
    openPayState(token).pipe(Effect.flatMap(loadPayStateHoldExpiry))
);
