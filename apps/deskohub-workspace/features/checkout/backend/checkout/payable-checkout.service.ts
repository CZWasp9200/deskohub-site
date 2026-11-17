import {
  type DotyposReadFailure,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type { SealedStateTokenError } from "@/shared/backend/sealed-state";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { currentInstant } from "@/shared/utils/temporal";
import { PaymentAttemptRepository } from "../repositories/payment-attempt.repository";
import { deriveCheckoutSessionKeys } from "./checkout-lookup-keys.server";
import {
  CheckoutUnavailableError,
  type CheckoutUnavailableReason,
} from "./checkout-unavailable";
import {
  PayState,
  type PayStatePage,
  type PayStateTokenError,
  type PayStateWithHoldExpiry,
  type SignedPayState,
} from "./pay-state";
import {
  findPayStateAttemptRefusal,
  getPayStateBinding,
} from "./pay-state-contract";
import { withPayStateHoldExpiry } from "./pay-state-hold";

/**
 * A reservation that holds its booking until its stored deadline, under the
 * Dotypos reservation that books it.
 */
export type PayableReservation = WorkspaceReservation & {
  readonly reservationHoldExpiresAt: Temporal.Instant;
  readonly dotyposReservationId: DotyposReservationId;
};

/**
 * An opened Pay state whose order was payable when it was confirmed: the
 * state with its hold deadline, and the reservation it pays for. The
 * reservation's `dotyposCustomerId` is the customer it prices for.
 */
export type OpenCheckout = {
  readonly state: PayStateWithHoldExpiry;
  readonly reservation: PayableReservation;
};

/** What reading the order's reservation, locally or in Dotypos, can fail with. */
export type PayableCheckoutReadError =
  | SealedStateTokenError
  | EffectDrizzleQueryError
  | WorkspaceReservationDetailsMalformedError
  | DotyposReadFailure;

export interface IPayableCheckout {
  /**
   * Opens a Pay state and confirms its order is payable, as `reconfirm` does.
   * Given a page, the state must also continue on it (`PayState.open`). A
   * token that doesn't open fails as a `PayStateTokenError` and reads no
   * reservation.
   */
  readonly open: (input: {
    readonly payStateToken: string;
    readonly page?: PayStatePage;
  }) => Effect.Effect<
    OpenCheckout,
    PayStateTokenError | CheckoutUnavailableError | PayableCheckoutReadError
  >;
  /**
   * Confirms, now, that an opened Pay state's order is payable: it is the
   * current reservation of the state's checkout session, held before its
   * deadline both before and after Dotypos reports its reservation still
   * NEW.
   *
   * The answer holds only for the moment it was read. A caller that signs a
   * price or starts a payment on it calls this again immediately before
   * doing so, after its own slow steps; nothing here can enforce that order.
   */
  readonly reconfirm: (
    state: SignedPayState
  ) => Effect.Effect<
    OpenCheckout,
    CheckoutUnavailableError | PayableCheckoutReadError
  >;
}

export class PayableCheckout extends Context.Service<
  PayableCheckout,
  IPayableCheckout
>()("PayableCheckout") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const paymentAttempts = yield* PaymentAttemptRepository;
      const dotypos = yield* DotyposService;
      const provideSealedStateKeys = Effect.provideService(
        SealedStateKeys,
        yield* SealedStateKeys
      );

      /**
       * The order, when it is the current reservation of its checkout
       * session: the state's own session, or for an order-bound (payment
       * retry) state the session the order was booked in, and while the
       * state may still start a payment (`findPayStateAttemptRefusal`).
       */
      const findSessionReservation = Effect.fnUntraced(function* (
        state: SignedPayState
      ) {
        const reservation = yield* reservations.findById(state.orderId);
        if (!reservation) {
          return yield* unavailable(state, "missing_reservation");
        }
        const refuse = (reason: CheckoutUnavailableReason) =>
          unavailable(state, reason, reservation);
        const binding = getPayStateBinding(state);
        if (!binding) {
          return yield* refuse("missing_checkout_session");
        }

        const attemptRefusal = findPayStateAttemptRefusal(
          binding,
          reservation,
          binding.kind === "order"
            ? ((yield* paymentAttempts.findNewestForReservation(reservation.id))
                ?.id ?? null)
            : null
        );
        if (attemptRefusal) return yield* refuse(attemptRefusal);
        // An order-bound state carries no raw session id: only the order's
        // stored session key is known.
        if (binding.kind === "session") {
          const checkoutSessionKeys = yield* deriveCheckoutSessionKeys(
            binding.checkoutSessionId
          ).pipe(provideSealedStateKeys);
          if (
            !checkoutSessionKeys.accepted.includes(
              reservation.checkoutSessionKey
            )
          ) {
            return yield* refuse("not_current");
          }
        }
        const current = yield* reservations.findCurrentByCheckoutSessionKey(
          reservation.checkoutSessionKey
        );
        if (current?.id !== reservation.id) {
          return yield* refuse("not_current");
        }
        return reservation;
      });

      const reconfirm: IPayableCheckout["reconfirm"] = Effect.fn(
        "payableCheckout.reconfirm"
      )(function* (state) {
        const reservation = yield* findSessionReservation(state);
        const refuse = (reason: CheckoutUnavailableReason) =>
          unavailable(state, reason, reservation);

        const { reservationHoldExpiresAt, dotyposReservationId } = reservation;
        // Payment never starts on a hold without a deadline, so it holds
        // nothing.
        if (
          reservation.reservationState !== "held" ||
          reservationHoldExpiresAt === null
        ) {
          return yield* refuse("not_held");
        }
        if (yield* hasPassed(reservationHoldExpiresAt)) {
          return yield* refuse("expired");
        }
        if (!dotyposReservationId) {
          return yield* refuse("missing_dotypos_reservation");
        }

        const status =
          yield* dotypos.getReservationStatus(dotyposReservationId);
        // The remote read takes time: payment may have completed and the hold
        // may have run out meanwhile, so a refusal from here on names a paid
        // order from the row as it is now.
        const refuseAfterRead = (reason: CheckoutUnavailableReason) =>
          reservations
            .findById(state.orderId)
            .pipe(
              Effect.flatMap((latest) =>
                Effect.fail(unavailable(state, reason, latest ?? reservation))
              )
            );
        if (status !== "NEW") {
          return yield* refuseAfterRead("dotypos_not_pending");
        }
        if (yield* hasPassed(reservationHoldExpiresAt)) {
          return yield* refuseAfterRead("expired");
        }

        const payable: PayableReservation = {
          ...reservation,
          reservationHoldExpiresAt,
          dotyposReservationId,
        };
        const checkout: OpenCheckout = {
          state: withPayStateHoldExpiry(state, payable),
          reservation: payable,
        };
        return checkout;
      });

      return PayableCheckout.of({
        open: Effect.fn("payableCheckout.open")(function* (input) {
          const state = yield* PayState.open(
            input.payStateToken,
            input.page
          ).pipe(provideSealedStateKeys);
          return yield* reconfirm(state);
        }),
        reconfirm,
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceReservationRepository.Live,
        PaymentAttemptRepository.Default.pipe(
          Layer.provide(WorkspaceDatabase.Default)
        ),
        WorkspaceDotyposLayer,
        SealedStateKeys.Default
      )
    )
  );
}

/** Whether `deadline` is at or before the current instant. */
const hasPassed = (deadline: Temporal.Instant) =>
  currentInstant.pipe(
    Effect.map((now) => Temporal.Instant.compare(deadline, now) <= 0)
  );

const unavailable = (
  state: SignedPayState,
  reason: CheckoutUnavailableReason,
  reservation?: Pick<WorkspaceReservation, "id" | "paymentState">
) =>
  new CheckoutUnavailableError({
    orderId: state.orderId,
    reason,
    restartKind: state.reservation.kind,
    ...(reservation?.paymentState === "paid" && {
      paidOrderId: reservation.id,
    }),
  });
