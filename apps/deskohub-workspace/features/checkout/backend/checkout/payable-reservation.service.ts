import { type DotyposReadFailure, DotyposService } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type { SealedStateTokenError } from "@/shared/backend/sealed-state";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { deriveCheckoutSessionKeys } from "./checkout-lookup-keys.server";
import {
  getPayStateBinding,
  isPayStateAttemptCurrent,
  type PayStateBinding,
  type SignedPayStateEnvelope,
} from "./pay-state-contract";

export class PayableReservationUnavailableError extends Data.TaggedError(
  "PayableReservationUnavailableError"
)<{
  readonly orderId: WorkspaceReservationId;
  readonly reason:
    | "missing_checkout_session"
    | "missing_reservation"
    | "not_current"
    | "retried_attempt_replaced"
    | "not_held"
    | "expired"
    | "missing_dotypos_reservation"
    | "dotypos_not_pending";
}> {}

/** The part of a Pay state that names the order it may pay. */
export type PayableReservationRequest = Pick<
  SignedPayStateEnvelope,
  "orderId" | "checkoutSessionId" | "binding" | "retriedAttemptId"
>;

interface IPayableReservationService {
  /**
   * The order a Pay state may still pay: a session-bound state's order while
   * it is its session's current order, an order-bound (payment retry) state's
   * order while it is the current order of its own stored session and the
   * retried attempt is still its active one; either way held, unexpired, and
   * pending in Dotypos.
   */
  readonly requireCurrent: (
    input: PayableReservationRequest
  ) => Effect.Effect<
    WorkspaceReservation,
    | PayableReservationUnavailableError
    | SealedStateTokenError
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
    | DotyposReadFailure
  >;
}

export class PayableReservationService extends Context.Service<
  PayableReservationService,
  IPayableReservationService
>()("PayableReservationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const dotypos = yield* DotyposService;
      const sealedStateKeys = yield* SealedStateKeys;

      const findReservation = Effect.fnUntraced(function* (
        orderId: WorkspaceReservationId
      ) {
        const reservation = yield* reservations.findById(orderId);
        if (!reservation) {
          return yield* unavailable({ orderId }, "missing_reservation");
        }
        return reservation;
      });

      /** Refuses an order its checkout session has since replaced. */
      const requireCurrentOfStoredSession = Effect.fnUntraced(function* (
        reservation: WorkspaceReservation
      ) {
        const current = yield* reservations.findCurrentByCheckoutSessionKey(
          reservation.checkoutSessionKey
        );
        if (current?.id !== reservation.id) {
          return yield* unavailable({ orderId: reservation.id }, "not_current");
        }
        return reservation;
      });

      /** The order, when it is the current reservation of this checkout session. */
      const findSessionReservation = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly checkoutSessionId: CheckoutSessionId;
      }) {
        const checkoutSessionKeys = yield* deriveCheckoutSessionKeys(
          input.checkoutSessionId
        ).pipe(Effect.provideService(SealedStateKeys, sealedStateKeys));
        const reservation = yield* findReservation(input.orderId);
        if (
          !checkoutSessionKeys.accepted.includes(reservation.checkoutSessionKey)
        ) {
          return yield* unavailable(input, "not_current");
        }
        return yield* requireCurrentOfStoredSession(reservation);
      });

      /**
       * The order of an order-bound Pay state, when it is still the current
       * order of the checkout session it was booked in and the attempt the
       * state retries is still its active one. Only the stored key is known;
       * the state carries no raw session ID.
       */
      const findBoundOrder = Effect.fnUntraced(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly binding: Extract<PayStateBinding, { readonly kind: "order" }>;
      }) {
        const reservation = yield* findReservation(input.orderId);
        if (!isPayStateAttemptCurrent(input.binding, reservation)) {
          return yield* unavailable(input, "retried_attempt_replaced");
        }
        return yield* requireCurrentOfStoredSession(reservation);
      });

      return PayableReservationService.of({
        requireCurrent: Effect.fn("payableReservation.requireCurrent")(
          function* (input) {
            const binding = getPayStateBinding(input);
            if (!binding) {
              return yield* unavailable(input, "missing_checkout_session");
            }

            const reservation =
              binding.kind === "order"
                ? yield* findBoundOrder({ orderId: input.orderId, binding })
                : yield* findSessionReservation({
                    orderId: input.orderId,
                    checkoutSessionId: binding.checkoutSessionId,
                  });

            const holdRefusal = getHoldRefusal(reservation);
            if (holdRefusal) return yield* unavailable(input, holdRefusal);

            if (!reservation.dotyposReservationId) {
              return yield* unavailable(input, "missing_dotypos_reservation");
            }

            const status = yield* dotypos.getReservationStatus(
              reservation.dotyposReservationId
            );
            if (status !== "NEW") {
              return yield* unavailable(input, "dotypos_not_pending");
            }

            return reservation;
          }
        ),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceReservationRepository.Live),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(SealedStateKeys.Default)
  );
}

const unavailable = (
  input: { readonly orderId: WorkspaceReservationId },
  reason: PayableReservationUnavailableError["reason"]
) =>
  new PayableReservationUnavailableError({
    orderId: input.orderId,
    reason,
  });

/** Why the reservation no longer holds its booking, if it doesn't. */
const getHoldRefusal = (
  reservation: Pick<
    WorkspaceReservation,
    "reservationState" | "reservationHoldExpiresAt"
  >
): PayableReservationUnavailableError["reason"] | undefined => {
  if (reservation.reservationState !== "held") return "not_held";
  if (
    reservation.reservationHoldExpiresAt &&
    Temporal.Instant.compare(
      reservation.reservationHoldExpiresAt,
      Temporal.Now.instant()
    ) <= 0
  ) {
    return "expired";
  }
  return undefined;
};
