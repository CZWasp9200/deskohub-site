import "@/shared/polyfills/temporal";

import {
  type DotyposReservationId,
  type DotyposReservationStatus,
  DotyposService,
  type DotyposWriteFailure,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Predicate } from "effect";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import {
  type ExpectedReservationHold,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
  type WorkspaceReservationStateError,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { DotyposHoldRelease } from "./dotypos-hold-release.service";

/**
 * Why an unpaid hold is released. Each reason brings its own policy:
 *
 * - `hold_expired`: hold cleanup of an expired or abandoned hold.
 * - `late_payment`: late-payment recovery frees the original hold before it
 *   recreates the reservation or refunds.
 * - `agent_rotated`: an agent client's hold left behind in a rotated checkout
 *   session.
 * - `payment_retry`: a customer retries the order's failed, cancelled or
 *   expired payment, and its hold expired; the retry books the reservation
 *   again for the same order once this hold is released.
 */
type UnpaidHoldReleaseReason =
  | "hold_expired"
  | "late_payment"
  | "agent_rotated"
  | "payment_retry";

export type UnpaidHoldReleaseRequest =
  | {
      readonly reason: "hold_expired";
      readonly reservationId: WorkspaceReservationId;
      /**
       * The hold cleanup found expired. A reservation that has carried
       * another hold or deadline since is left alone.
       */
      readonly expectedHold: ExpectedReservationHold;
      /** When cleanup found the hold expired; recorded with the cancellation. */
      readonly holdExpiredAt?: Temporal.Instant;
    }
  | {
      readonly reason: "late_payment";
      readonly reservationId: WorkspaceReservationId;
      /**
       * The Dotypos hold the late payment was for, as its recovery recorded
       * it. Released even when another recovery has since written a
       * replacement's hold on the reservation.
       */
      readonly originalDotyposReservationId: DotyposReservationId;
    }
  | {
      readonly reason: "agent_rotated";
      readonly reservationId: WorkspaceReservationId;
    }
  | {
      readonly reason: "payment_retry";
      readonly reservationId: WorkspaceReservationId;
      /** The hold the retry found; a reservation carrying another is left alone. */
      readonly expectedHold: ExpectedReservationHold;
    };

/** A hold this run released and marked cancelled. */
interface ReleasedHold {
  /** The reservation as this run took it over, before it was marked cancelled. */
  readonly released: WorkspaceReservation;
  readonly cancelledAt: Temporal.Instant;
}

/** A hold left in Dotypos because of its live status. */
interface RefusedHold {
  readonly refused: DotyposReservationStatus;
}

/**
 * Another run's cancellation claim on the reservation is fresh, so this run
 * leaves it to that run. At `staleAt` the claim counts as interrupted and a
 * later release may take it over.
 */
export class HoldCancellationInProgress extends Data.TaggedClass(
  "HoldCancellationInProgress"
)<{
  readonly staleAt: Temporal.Instant;
}> {}

/**
 * - `already_released`: the reservation was cancelled already, or another run
 *   marked it cancelled while this one released it.
 * - `HoldCancellationInProgress`: another run's cancellation of it is fresh,
 *   so this run leaves it alone.
 * - `unclaimed`: the reservation changed before this run could claim it, or
 *   it no longer carries the hold the release was for.
 * - `unreleasable`: it isn't an unpaid hold with a Dotypos reservation this
 *   reason may release.
 * - `state_changed`: it left `cancelling`, or another run took over the
 *   claim, before this run marked it cancelled, after the Dotypos release.
 * - `refused`: the live Dotypos status kept the hold; under `require_new`
 *   the reservation moved to `cancellation_failed`, under
 *   `read_before_claim` it is untouched.
 */
type UnpaidHoldReleaseOutcome =
  | ReleasedHold
  | "already_released"
  | HoldCancellationInProgress
  | "unclaimed"
  | "unreleasable"
  | "state_changed"
  | RefusedHold;

type UnpaidHoldReleaseError =
  | DotyposWriteFailure
  | EffectDrizzleQueryError
  | WorkspaceReservationDetailsMalformedError
  | WorkspaceReservationStateError;

/**
 * The `failure_code` a reservation keeps when its Dotypos hold wasn't
 * released. Stored values the administration attention queue reads.
 */
type ReleaseFailureCode =
  | "dotypos_cancel_failed"
  | "checkout_supersession_cancel_failed";

/**
 * How one reason releases a hold after its claim (see `claimHold`).
 *
 * `liveStatus`, what the live Dotypos status must be:
 * - `require_new`: read it after the claim; cancel `NEW`, take `CANCELLED` as
 *   released, refuse anything else.
 * - `read_before_claim`: the late-payment claim read it before claiming and
 *   refused anything but `NEW` and `CANCELLED` without touching the
 *   reservation; cancel only `NEW`.
 *
 * `markerRefused`, what a cancelled marker the reservation's state refuses
 * means:
 * - `state_changed`: the run reports it.
 * - `confirm_cancelled`: another run finished the cancellation when the
 *   reservation reads `cancelled`; the refusal fails the release otherwise.
 * - `fails`: the refusal fails the release.
 */
interface ReleasePolicy {
  readonly liveStatus: "require_new" | "read_before_claim";
  readonly failureCode: ReleaseFailureCode;
  readonly markerRefused: "state_changed" | "confirm_cancelled" | "fails";
}

const releasePolicies = {
  hold_expired: {
    liveStatus: "require_new",
    failureCode: "dotypos_cancel_failed",
    markerRefused: "state_changed",
  },
  late_payment: {
    liveStatus: "read_before_claim",
    failureCode: "dotypos_cancel_failed",
    markerRefused: "confirm_cancelled",
  },
  agent_rotated: {
    liveStatus: "require_new",
    failureCode: "checkout_supersession_cancel_failed",
    markerRefused: "fails",
  },
  payment_retry: {
    liveStatus: "require_new",
    failureCode: "dotypos_cancel_failed",
    markerRefused: "state_changed",
  },
} as const satisfies Record<UnpaidHoldReleaseReason, ReleasePolicy>;

/**
 * Local states whose Dotypos hold may still exist, as late-payment recovery
 * finds them before it releases the hold.
 */
const releasableReservationStates: ReadonlySet<string> = new Set([
  "held",
  "hold_expired",
  "cancellation_failed",
  "cancelling",
]);

/**
 * A `cancelling` reservation whose claim is this old belongs to an
 * interrupted run, so a release may take it over instead of waiting
 * indefinitely. A fresher claim belongs to a run that is still going, whatever
 * its reason: only its claimant records the outcome.
 */
const staleHoldCancellationAfter = Temporal.Duration.from({ minutes: 10 });

/** The other run's claim, while it is fresh; nothing once it is stale. */
const freshClaimInProgress = (
  reservation: WorkspaceReservation,
  now: Temporal.Instant
) => {
  const staleAt = reservation.updatedAt.add(staleHoldCancellationAfter);
  return Temporal.Instant.compare(staleAt, now) > 0
    ? new HoldCancellationInProgress({ staleAt })
    : undefined;
};

/**
 * A claimed hold: `claimedAt` is the claim's stamp, which every outcome this
 * run records requires, and `statusBeforeClaim` the live status read before
 * the claim, if any.
 */
interface ClaimedHold {
  readonly reservation: WorkspaceReservation;
  readonly claimedAt: Temporal.Instant;
  readonly dotyposReservationId: DotyposReservationId;
  readonly statusBeforeClaim?: "NEW" | "CANCELLED";
}

/** A hold this run claimed, or the outcome that ended the release first. */
type ClaimResult =
  | ClaimedHold
  | Exclude<UnpaidHoldReleaseOutcome, ReleasedHold | "state_changed">;

const isClaimedHold = (result: ClaimResult): result is ClaimedHold =>
  !Predicate.isString(result) && "reservation" in result;

const isClaimedRow = (
  result: WorkspaceReservation | ClaimResult
): result is WorkspaceReservation =>
  !Predicate.isString(result) && "reservationState" in result;

/** Whether the reservation still carries the hold and deadline `expected`. */
const carriesHold = (
  reservation: WorkspaceReservation,
  expected: ExpectedReservationHold
) =>
  reservation.dotyposReservationId === expected.dotyposReservationId &&
  reservation.reservationHoldExpiresAt !== null &&
  reservation.reservationHoldExpiresAt.equals(
    expected.reservationHoldExpiresAt
  );

interface IUnpaidHoldRelease {
  /**
   * Releases an unpaid reservation hold for a reason: claims the
   * reservation's cancellation, releases its Dotypos hold under the reason's
   * live-status rule, and marks the reservation cancelled. A hold left in
   * Dotypos after the claim moves the reservation to `cancellation_failed`
   * with the reason's stored code, and a Dotypos failure fails the release
   * after that marker.
   */
  readonly release: (
    request: UnpaidHoldReleaseRequest
  ) => Effect.Effect<UnpaidHoldReleaseOutcome, UnpaidHoldReleaseError>;
}

export class UnpaidHoldRelease extends Context.Service<
  UnpaidHoldRelease,
  IUnpaidHoldRelease
>()("UnpaidHoldRelease") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const dotypos = yield* DotyposService;
      const holdRelease = yield* DotyposHoldRelease;

      // Claims the cancellation of the expected hold, or takes over a stale
      // claim on it; leaves a fresh claim to its run, and is unreleasable
      // after logging why it may not be released.
      const claimExpectedHold = Effect.fnUntraced(function* (request: {
        readonly reason: "hold_expired" | "payment_retry";
        readonly reservationId: WorkspaceReservationId;
        readonly expectedHold: ExpectedReservationHold;
      }): Effect.fn.Return<ClaimResult, UnpaidHoldReleaseError> {
        const { reservationId, expectedHold } = request;
        const claimedFromNew = yield* reservations.claimCancellation({
          id: reservationId,
          expectedHold,
          cause: request.reason,
        });
        yield* Effect.logDebug(
          "Reservation hold cancellation claim completed",
          { claimedFromNew: claimedFromNew !== null }
        );
        const claimed =
          claimedFromNew ?? (yield* takeOverExpectedHold(request));
        if (!isClaimedRow(claimed)) return claimed;
        if (claimed.reservationState !== "cancelling") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: claim not cancellable"
          );
          return "unreleasable" as const;
        }
        if (!claimed.dotyposReservationId) {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: missing Dotypos reservation"
          );
          return "unreleasable" as const;
        }
        if (claimed.paymentState === "paid") {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: reservation paid"
          );
          return "unreleasable" as const;
        }
        return {
          reservation: claimed,
          claimedAt: claimed.updatedAt,
          dotyposReservationId: claimed.dotyposReservationId,
        } satisfies ClaimedHold;
      });

      // Without a fresh claim of its own, the reservation is either another
      // run's claim, fresh or stale, or no longer the expected hold's.
      const takeOverExpectedHold = Effect.fnUntraced(function* (request: {
        readonly reservationId: WorkspaceReservationId;
        readonly expectedHold: ExpectedReservationHold;
      }): Effect.fn.Return<
        WorkspaceReservation | ClaimResult,
        UnpaidHoldReleaseError
      > {
        const current = yield* reservations.findById(request.reservationId);
        if (!current) return "unreleasable" as const;
        if (!carriesHold(current, request.expectedHold)) {
          yield* Effect.logWarning(
            "Reservation hold cancellation skipped: reservation carries another hold"
          );
          return "unclaimed" as const;
        }
        if (current.reservationState !== "cancelling") return current;
        const now = Temporal.Now.instant();
        const inProgress = freshClaimInProgress(current, now);
        if (inProgress) {
          yield* Effect.logInfo(
            "Reservation hold cancellation left to another run's fresh claim",
            { staleAt: inProgress.staleAt }
          );
          return inProgress;
        }
        const takenOver = yield* reservations.takeOverStaleCancellation({
          id: request.reservationId,
          staleBefore: now.subtract(staleHoldCancellationAfter),
          expectedHold: request.expectedHold,
        });
        return takenOver ?? ("unclaimed" as const);
      });

      // Claims a `held` reservation whose payment may be superseded.
      const claimSupersession = Effect.fnUntraced(function* (
        reservationId: WorkspaceReservationId
      ): Effect.fn.Return<ClaimResult, UnpaidHoldReleaseError> {
        const claimed =
          yield* reservations.claimSupersessionCancellation(reservationId);
        if (!claimed) return "unclaimed" as const;
        // workspace_reservations_hold_id_check rejects a cancelling row
        // without its Dotypos hold, so a claimed row always carries one.
        if (!claimed.dotyposReservationId) return "unreleasable" as const;
        return {
          reservation: claimed,
          claimedAt: claimed.updatedAt,
          dotyposReservationId: claimed.dotyposReservationId,
        } satisfies ClaimedHold;
      });

      // From the current reservation, releases a cancelled one as done, waits
      // out a fresh `cancelling` one, takes over a stale one, and claims the
      // cancellation otherwise. Reads the original hold's live status before
      // the claim, so a hold Dotypos no longer keeps pending leaves the
      // reservation untouched.
      const claimResumingStale = Effect.fnUntraced(function* (request: {
        readonly reservationId: WorkspaceReservationId;
        readonly originalDotyposReservationId: DotyposReservationId;
      }): Effect.fn.Return<ClaimResult, UnpaidHoldReleaseError> {
        const reservation = yield* reservations.findById(request.reservationId);
        if (!reservation) {
          return yield* Effect.die(
            "Unpaid hold release reservation disappeared before release."
          );
        }
        if (reservation.reservationState === "cancelled") {
          return "already_released" as const;
        }
        if (!releasableReservationStates.has(reservation.reservationState)) {
          return "unreleasable" as const;
        }
        const resumesStaleCancellation =
          reservation.reservationState === "cancelling";
        const now = Temporal.Now.instant();
        const inProgress =
          resumesStaleCancellation && freshClaimInProgress(reservation, now);
        if (inProgress) return inProgress;

        const status = yield* dotypos.getReservationStatus(
          request.originalDotyposReservationId
        );
        if (status !== "NEW" && status !== "CANCELLED") {
          return { refused: status } satisfies RefusedHold;
        }
        const claimed = resumesStaleCancellation
          ? yield* reservations.takeOverStaleCancellation({
              id: reservation.id,
              staleBefore: now.subtract(staleHoldCancellationAfter),
            })
          : yield* reservations.claimCancellation({
              id: reservation.id,
              cause: "late_payment",
            });
        if (!claimed) return "unclaimed" as const;
        return {
          reservation,
          claimedAt: claimed.updatedAt,
          dotyposReservationId: request.originalDotyposReservationId,
          statusBeforeClaim: status,
        } satisfies ClaimedHold;
      });

      // Each reason's claim. Hold cleanup and agent rotated holds release the
      // Dotypos hold on the row they claimed; late payment releases the
      // original hold its recovery recorded.
      const claimHold = (request: UnpaidHoldReleaseRequest) => {
        switch (request.reason) {
          case "hold_expired":
          case "payment_retry":
            return claimExpectedHold(request);
          case "late_payment":
            return claimResumingStale(request);
          case "agent_rotated":
            return claimSupersession(request.reservationId);
        }
      };

      // Releases the claimed hold in Dotypos: a refusal when its live status
      // keeps it there, nothing when it may be marked cancelled.
      const releaseDotyposHold = (
        policy: ReleasePolicy,
        claimed: ClaimedHold
      ) => {
        if (claimed.statusBeforeClaim === "CANCELLED") return Effect.void;
        return holdRelease
          .release({
            reservationId: claimed.reservation.id,
            claimedAt: claimed.claimedAt,
            dotyposReservationId: claimed.dotyposReservationId,
            liveStatus:
              policy.liveStatus === "require_new" ? "require_new" : "unchecked",
            failureCode: policy.failureCode,
          })
          .pipe(
            Effect.map((outcome) =>
              Predicate.isString(outcome) ? undefined : outcome
            )
          );
      };

      // Marks the released hold cancelled; a marker the reservation's state
      // refuses is settled under the policy.
      const markReleased = Effect.fnUntraced(function* (
        policy: ReleasePolicy,
        claimed: ClaimedHold,
        holdExpiry: { readonly holdExpiredAt?: Temporal.Instant }
      ) {
        const cancelledAt = Temporal.Now.instant();
        return yield* reservations
          .markCancelled({
            id: claimed.reservation.id,
            claimedAt: claimed.claimedAt,
            cancelledAt,
            ...holdExpiry,
          })
          .pipe(
            Effect.as<UnpaidHoldReleaseOutcome>({
              released: claimed.reservation,
              cancelledAt,
            }),
            Effect.catchTag(
              "WorkspaceReservationStateError",
              Effect.fnUntraced(function* (refusal) {
                if (policy.markerRefused === "state_changed") {
                  return "state_changed" as const;
                }
                if (policy.markerRefused === "confirm_cancelled") {
                  const current = yield* reservations.findById(
                    claimed.reservation.id
                  );
                  if (current?.reservationState === "cancelled") {
                    return "already_released" as const;
                  }
                }
                return yield* refusal;
              })
            )
          );
      });

      return UnpaidHoldRelease.of({
        release: Effect.fn("unpaidHoldRelease.release")(function* (request) {
          yield* Effect.annotateCurrentSpan({ reason: request.reason });
          const policy: ReleasePolicy = releasePolicies[request.reason];
          const claimed = yield* claimHold(request);
          if (!isClaimedHold(claimed)) return claimed;
          const refused = yield* releaseDotyposHold(policy, claimed);
          if (refused) return refused;
          return yield* markReleased(
            policy,
            claimed,
            // Only cleanup records when it found the hold expired; the other
            // reasons leave the column untouched.
            request.reason === "hold_expired"
              ? { holdExpiredAt: request.holdExpiredAt }
              : {}
          );
        }),
      });
    })
  ).pipe(Layer.provide(DotyposHoldRelease.Default));
}
