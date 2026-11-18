import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import { administrationForcedPaymentCancellationFailureCode } from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import {
  type RequestedCancellationCause,
  type RequestedCancellationRefund,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationDetails,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  canCancelReservation,
  REQUESTED_CANCELLATION_RETRY_AFTER_MS,
} from "@/features/reservation/reservation-cancellation-policy";

export type ReservationCancellationFailureReason =
  | "not_found"
  | "delivery_in_progress"
  | "confirmation_in_progress"
  | "invalid_state"
  | "cancelled_in_dotypos"
  | "pending_payment"
  | "changed"
  | "reservation_unavailable"
  | "details_unavailable"
  | "claim_failed"
  | "dotypos_failed"
  | "record_failed";

export class ReservationCancellationError extends Data.TaggedError(
  "ReservationCancellationError"
)<{
  readonly code: "not_found" | "not_cancellable" | "cancellation_failed";
  /** Why the cancellation stopped, so a caller can explain it in its own words. */
  readonly reason: ReservationCancellationFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ReservationCancellationInput = {
  readonly reservationId: WorkspaceReservationId;
  readonly cause: RequestedCancellationCause;
  /** An administrator's override that cancels a pending payment too. */
  readonly force?: boolean;
  /** What the payment owes back; absent, the whole Nexi payment is owed. */
  readonly refund?: RequestedCancellationRefund;
};

export type ReservationCancellationResult =
  | { readonly outcome: "already_cancelled" }
  | {
      readonly outcome: "cancelled";
      /** The reservation as it stood before cancellation. */
      readonly reservation: WorkspaceReservationDetails;
    };

interface IReservationCancellation {
  /**
   * Cancels a reservation an administrator or the customer asked to cancel:
   * claims it, which expires its access, cancels the Dotypos booking, then
   * records the cancellation with the refund its payment owes. Repeating a
   * cancellation that failed part way resumes it; a cancelled reservation
   * answers `already_cancelled`.
   */
  readonly cancel: (
    input: ReservationCancellationInput
  ) => Effect.Effect<
    ReservationCancellationResult,
    ReservationCancellationError
  >;
}

/** The reservation cancellation lifecycle every requested cancellation runs. */
export class ReservationCancellation extends Context.Service<
  ReservationCancellation,
  IReservationCancellation
>()("@deskohub-workspace/reservation/ReservationCancellation") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const reservations = yield* WorkspaceReservationRepository;
      const reservationDetails = yield* WorkspaceReservationService;

      const claimCancellation = Effect.fnUntraced(function* (
        current: WorkspaceReservation,
        cause: RequestedCancellationCause,
        forcedPendingPayment: boolean
      ) {
        const pendingPaymentCancellation = getPendingPaymentCancellation(
          current,
          forcedPendingPayment
        );
        const claimed = yield* reservations
          .claimRequestedCancellation({
            id: current.id,
            cause,
            ...(pendingPaymentCancellation && {
              pendingPaymentCancellation,
            }),
            staleCancellingBefore: Temporal.Now.instant().subtract({
              milliseconds: REQUESTED_CANCELLATION_RETRY_AFTER_MS,
            }),
          })
          .pipe(
            Effect.mapError((error) =>
              cancellationFailed(
                "claim_failed",
                "The reservation could not be claimed for cancellation.",
                error
              )
            )
          );
        if (!claimed) {
          return yield* new ReservationCancellationError({
            code: "not_cancellable",
            reason: "changed",
            message:
              "The reservation changed while cancellation was starting. Refresh and try again.",
          });
        }
        return claimed;
      });

      /**
       * Cancels the reservation in Dotypos. When that fails, a reservation
       * Dotypos already reports as cancelled counts as done; otherwise the
       * claim is marked failed.
       */
      const cancelInDotypos = Effect.fnUntraced(function* (
        details: WorkspaceReservationDetails,
        claimed: WorkspaceReservation,
        cause: RequestedCancellationCause,
        administrationForceCancellation: boolean
      ) {
        yield* dotypos.cancelReservation(details.dotyposReservationId).pipe(
          Effect.catch(
            Effect.fn(function* (error) {
              const cancelled = yield* reservationDetails
                .getReservation(claimed.id)
                .pipe(
                  Effect.map((latest) => latest.providerStatus === "CANCELLED"),
                  Effect.orElseSucceed(() => false)
                );
              if (cancelled) return;

              yield* reservations
                .markRequestedCancellationFailed({
                  id: claimed.id,
                  claimedAt: claimed.updatedAt,
                  failureCode: getCancellationFailureCode(
                    administrationForceCancellation,
                    cancellationFailureCodes[cause].dotypos
                  ),
                })
                .pipe(Effect.ignore);
              return yield* Effect.fail(error);
            })
          ),
          Effect.mapError((error) =>
            cancellationFailed(
              "dotypos_failed",
              "Dotypos could not cancel the reservation.",
              error
            )
          )
        );
      });

      /** Records the completed cancellation, or marks the claim failed when that write fails. */
      const recordCancellation = Effect.fnUntraced(function* (
        claimed: WorkspaceReservation,
        cause: RequestedCancellationCause,
        administrationForceCancellation: boolean,
        refund: RequestedCancellationRefund | undefined
      ) {
        yield* reservations
          .completeRequestedCancellation({
            id: claimed.id,
            cancelledAt: Temporal.Now.instant(),
            claimedAt: claimed.updatedAt,
            failureCode: getCancellationFailureCode(
              administrationForceCancellation,
              null
            ),
            ...(refund && { refund }),
          })
          .pipe(
            Effect.tapError(() =>
              reservations
                .markRequestedCancellationFailed({
                  id: claimed.id,
                  claimedAt: claimed.updatedAt,
                  failureCode: getCancellationFailureCode(
                    administrationForceCancellation,
                    cancellationFailureCodes[cause].local
                  ),
                })
                .pipe(Effect.ignore)
            ),
            Effect.mapError((error) =>
              cancellationFailed(
                "record_failed",
                "The completed cancellation could not be recorded.",
                error
              )
            )
          );
      });

      return {
        cancel: Effect.fn("ReservationCancellation.cancel")(
          function* (input) {
            const current = yield* reservations
              .findById(input.reservationId)
              .pipe(
                Effect.mapError((error) =>
                  cancellationFailed(
                    "reservation_unavailable",
                    "The reservation could not be loaded.",
                    error
                  )
                )
              );
            if (!current) {
              return yield* new ReservationCancellationError({
                code: "not_found",
                reason: "not_found",
                message: "The reservation was not found.",
              });
            }
            if (current.reservationState === "cancelled") {
              if (
                input.cause === "customer_withdrawal" &&
                current.cancellationCause !== input.cause
              ) {
                return yield* new ReservationCancellationError({
                  code: "not_cancellable",
                  reason: "invalid_state",
                  message:
                    "The reservation was cancelled outside the withdrawal.",
                });
              }
              return { outcome: "already_cancelled" } as const;
            }
            const forcedPendingPayment =
              current.paymentState === "pending" && input.force === true;
            const administrationForceCancellation =
              forcedPendingPayment ||
              current.failureCode ===
                administrationForcedPaymentCancellationFailureCode;
            if (
              !canCancelReservation(
                current,
                Temporal.Now.instant(),
                forcedPendingPayment
              )
            ) {
              return yield* getUncancellableReservationError(current);
            }

            const details = yield* reservationDetails
              .getReservation(current.id)
              .pipe(
                Effect.mapError((error) =>
                  cancellationFailed(
                    "details_unavailable",
                    "The current reservation details could not be loaded.",
                    error
                  )
                )
              );
            const refusal = getProviderStateRefusal(
              current,
              details,
              forcedPendingPayment,
              input.cause
            );
            if (refusal) return yield* refusal;
            const claimed = yield* claimCancellation(
              current,
              input.cause,
              forcedPendingPayment
            );

            if (details.providerStatus !== "CANCELLED") {
              yield* cancelInDotypos(
                details,
                claimed,
                input.cause,
                administrationForceCancellation
              );
            }

            yield* recordCancellation(
              claimed,
              input.cause,
              administrationForceCancellation,
              input.refund
            );

            return { outcome: "cancelled", reservation: details } as const;
          },
          (effect, input) =>
            effect.pipe(
              Effect.annotateLogs({
                reservationId: input.reservationId,
                cancellationCause: input.cause,
              })
            )
        ),
      } satisfies IReservationCancellation;
    })
  );
}

/** The failure code a requested cancellation records for each failed step. */
const cancellationFailureCodes = {
  operator: {
    dotypos: "admin_dotypos_cancel_failed",
    local: "admin_local_cancel_failed",
  },
  customer_withdrawal: {
    dotypos: "withdrawal_dotypos_cancel_failed",
    local: "withdrawal_local_cancel_failed",
  },
} as const satisfies Record<
  RequestedCancellationCause,
  { readonly dotypos: string; readonly local: string }
>;

const cancellationFailed = (
  reason: ReservationCancellationFailureReason,
  message: string,
  cause: unknown
) =>
  new ReservationCancellationError({
    code: "cancellation_failed",
    reason,
    message,
    cause,
  });

/** Why a reservation that can't be cancelled in its current state is refused. */
const getUncancellableReservationError = (
  current: Pick<WorkspaceReservation, "fulfillmentState">
) => {
  if (current.fulfillmentState === "awaiting_delivery") {
    return new ReservationCancellationError({
      code: "not_cancellable",
      reason: "delivery_in_progress",
      message:
        "The confirmation email is still being delivered. Try again after delivery completes.",
    });
  }
  if (current.fulfillmentState === "processing") {
    return new ReservationCancellationError({
      code: "not_cancellable",
      reason: "confirmation_in_progress",
      message:
        "The reservation is being confirmed. Try again after confirmation finishes.",
    });
  }
  return new ReservationCancellationError({
    code: "not_cancellable",
    reason: "invalid_state",
    message: "The reservation cannot be cancelled in its current state.",
  });
};

/**
 * Refuses an operator's cancellation Dotypos already made outside Workspace,
 * or one a pending payment blocks unless the operator forced it for an
 * active attempt.
 */
const getProviderStateRefusal = (
  current: Pick<
    WorkspaceReservation,
    "activePaymentAttemptId" | "paymentState" | "reservationState"
  >,
  details: Pick<WorkspaceReservationDetails, "providerStatus">,
  forcedPendingPayment: boolean,
  cause: RequestedCancellationCause
) => {
  // A customer's recorded withdrawal still ends the contract and marks its
  // refund when Dotypos already lost the booking; only Dotypos is skipped.
  if (
    details.providerStatus === "CANCELLED" &&
    cause === "operator" &&
    !["cancelling", "cancellation_failed"].includes(current.reservationState)
  ) {
    return new ReservationCancellationError({
      code: "not_cancellable",
      reason: "cancelled_in_dotypos",
      message:
        "Dotypos already reports this reservation as cancelled. Use the recovery workflow instead.",
    });
  }
  if (
    current.paymentState === "pending" &&
    (!forcedPendingPayment || !current.activePaymentAttemptId)
  ) {
    return new ReservationCancellationError({
      code: "not_cancellable",
      reason: "pending_payment",
      message:
        "The reservation has a pending payment. Retry with force only after reviewing the provider payment.",
    });
  }
  return undefined;
};

/** The pending payment a forced cancellation terminalizes with its claim. */
const getPendingPaymentCancellation = (
  current: Pick<WorkspaceReservation, "activePaymentAttemptId">,
  forcedPendingPayment: boolean
) =>
  forcedPendingPayment && current.activePaymentAttemptId
    ? {
        paymentAttemptId: current.activePaymentAttemptId,
        failureCode: administrationForcedPaymentCancellationFailureCode,
      }
    : undefined;

/** A forced cancellation keeps its own failure code on every outcome. */
const getCancellationFailureCode = <Code extends string | null>(
  administrationForceCancellation: boolean,
  code: Code
) =>
  administrationForceCancellation
    ? administrationForcedPaymentCancellationFailureCode
    : code;
