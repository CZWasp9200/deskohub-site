import "@/shared/polyfills/temporal";

import { DotyposService } from "@deskohub/dotypos";
import { Context, Effect, Layer, Predicate } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  enqueueReservationHoldCleanup,
  getReservationHoldExpiresAt,
} from "@/features/reservation/backend/reservation-holds.service";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  retryReacquirableCancellationCauses,
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { currentInstant } from "@/shared/utils/temporal";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentAttemptRepository } from "../repositories/payment-attempt.repository";
import {
  findOrderDotyposReservations,
  type RecreatedReservation,
  resumeOrCreateOrderDotyposReservation,
} from "../reservation/order-dotypos-reservation";
import {
  getWorkspaceReservationInterval,
  WorkspaceTableAssignmentService,
} from "../reservation/workspace-table-assignment.service";
import { ReservationHoldCleanupScheduleService } from "./reservation-hold-cleanup-queue.service";
import {
  HoldCancellationInProgress,
  UnpaidHoldRelease,
} from "./unpaid-hold-release.service";

/**
 * How long a hold a retry keeps must still last: one about to expire is
 * released and booked again instead, so the retry's payment doesn't start on
 * a hold that lapses under it.
 */
const keptHoldMinimumRemaining = Temporal.Duration.from({ minutes: 1 });

/**
 * Why the order's hold can't be secured for its payment retry:
 * - `not_retryable`: the order isn't an unpaid order whose retried attempt
 *   ended, its reservation has ended, a late payment is being recovered for
 *   it, or its cancellation wasn't its own expired or retried hold;
 * - `release_refused`: Dotypos keeps the expired hold (it isn't NEW), so it
 *   is left for an operator;
 * - `release_in_progress`: another run is releasing the hold right now;
 * - `changed`: the order changed while the retry worked on it, or Dotypos
 *   holds more than one reservation for it.
 */
type PaymentRetryHoldRefusal =
  | "not_retryable"
  | "release_refused"
  | "release_in_progress"
  | "changed";

type PaymentRetryHold =
  /** The order's hold, kept (`kept`) or booked again (`reacquired`). */
  | {
      readonly kind: "kept" | "reacquired";
      readonly reservation: WorkspaceReservation;
    }
  /** The space or a table is no longer free for the reservation. */
  | { readonly kind: "spot_unavailable" }
  | { readonly kind: "refused"; readonly reason: PaymentRetryHoldRefusal };

type PaymentRetryHoldRequest = {
  readonly orderId: WorkspaceReservationId;
  /** The order's active attempt whose payment failed, was cancelled or expired. */
  readonly retriedAttemptId: PaymentAttemptId;
  /** The reservation exactly as its last attempt accepted it. */
  readonly recreated: RecreatedReservation;
};

const refused = (reason: PaymentRetryHoldRefusal): PaymentRetryHold => ({
  kind: "refused",
  reason,
});

const retryablePaymentStates: ReadonlySet<string> = new Set([
  "failed",
  "cancelled",
  "expired",
]);

/**
 * Whether the order still awaits the retry of `retriedAttemptId`: its
 * payment ended unpaid on that attempt, which is its newest, and nothing
 * else is active (a retry prepared before clears it).
 */
const isRetriedOrder = (
  order: WorkspaceReservation,
  retriedAttemptId: PaymentAttemptId,
  newestAttemptId: PaymentAttemptId | undefined
) =>
  newestAttemptId === retriedAttemptId &&
  (order.activePaymentAttemptId === retriedAttemptId ||
    order.activePaymentAttemptId === null) &&
  retryablePaymentStates.has(order.paymentState);

/** Local states whose own unpaid hold a retry releases before booking again. */
const releasableHoldStates: ReadonlySet<string> = new Set([
  "held",
  "hold_expired",
  "cancellation_failed",
]);

const isReacquirable = (order: WorkspaceReservation) =>
  order.reservationState === "cancelled" &&
  retryReacquirableCancellationCauses.some(
    (cause) => cause === order.cancellationCause
  );

const keepLiveHold = Effect.fnUntraced(function* (input: {
  readonly order: WorkspaceReservation;
  readonly retriedAttemptId: PaymentAttemptId;
  readonly now: Temporal.Instant;
}) {
  const { order } = input;
  const heldUntilAfter = input.now.add(keptHoldMinimumRemaining);
  if (
    order.reservationState !== "held" ||
    !order.dotyposReservationId ||
    !order.reservationHoldExpiresAt ||
    Temporal.Instant.compare(order.reservationHoldExpiresAt, heldUntilAfter) <=
      0
  ) {
    return undefined;
  }
  const dotypos = yield* DotyposService;
  const status = yield* dotypos.getReservationStatus(
    order.dotyposReservationId
  );
  if (status !== "NEW") return undefined;
  const reservations = yield* WorkspaceReservationRepository;
  const kept = yield* reservations.releaseRetriedAttempt({
    id: order.id,
    retriedAttemptId: input.retriedAttemptId,
    heldUntilAfter,
  });
  return kept
    ? ({ kind: "kept", reservation: kept } satisfies PaymentRetryHold)
    : refused("changed");
});

/** Releases the order's own expired hold; a refusal when it can't. */
const releaseOwnHold = Effect.fnUntraced(function* (
  order: WorkspaceReservation
) {
  if (!releasableHoldStates.has(order.reservationState)) return undefined;
  if (!order.dotyposReservationId || !order.reservationHoldExpiresAt) {
    return refused("not_retryable");
  }
  const holdRelease = yield* UnpaidHoldRelease;
  const outcome = yield* holdRelease.release({
    reason: "payment_retry",
    reservationId: order.id,
    expectedHold: {
      dotyposReservationId: order.dotyposReservationId,
      reservationHoldExpiresAt: order.reservationHoldExpiresAt,
    },
  });
  if (Predicate.isString(outcome)) {
    return outcome === "already_released" ? undefined : refused("changed");
  }
  if (outcome instanceof HoldCancellationInProgress) {
    return refused("release_in_progress");
  }
  if ("refused" in outcome) return refused("release_refused");
  return undefined;
});

const bookAgain = Effect.fnUntraced(function* (input: {
  readonly order: WorkspaceReservation;
  readonly request: PaymentRetryHoldRequest;
  readonly now: Temporal.Instant;
}) {
  const { order, request } = input;
  const interval = yield* getWorkspaceReservationInterval(
    request.recreated.reservation
  );
  if (hasReservationIntervalEnded(interval, input.now)) {
    return refused("not_retryable");
  }
  // Only a NEW reservation an interrupted earlier retry of this order created
  // is taken over; a confirmed one, or more than one, is left alone.
  const found = yield* findOrderDotyposReservations({
    orderId: order.id,
    interval,
  });
  if (found.length > 1 || found.some(({ status }) => status !== "NEW")) {
    return refused("changed");
  }
  const settled = yield* resumeOrCreateOrderDotyposReservation({
    order,
    recreated: request.recreated,
    found,
    status: "NEW",
  });
  if (!settled) return { kind: "spot_unavailable" } as const;

  const reservations = yield* WorkspaceReservationRepository;
  const reservationHoldExpiresAt = getReservationHoldExpiresAt(input.now);
  const attached = yield* reservations.attachRetryHold({
    id: order.id,
    retriedAttemptId: request.retriedAttemptId,
    dotyposReservationId: settled.id,
    reservationHoldExpiresAt,
  });
  if (!attached) {
    // Only a reservation this run created is cancelled again; one it resumed
    // belongs to the run that made it.
    if (!settled.resumed) {
      const dotypos = yield* DotyposService;
      yield* dotypos.cancelReservation(settled.id);
    }
    return refused("changed");
  }
  // Hold cleanup's periodic recovery also finds an expired hold whose job
  // could not be scheduled.
  yield* enqueueReservationHoldCleanup({
    orderId: order.id,
    reservationHoldExpiresAt,
  });
  return {
    kind: "reacquired",
    reservation: attached,
  } satisfies PaymentRetryHold;
});

const secure = Effect.fn("PaymentRetryHoldService.secure")(
  function* (request: PaymentRetryHoldRequest) {
    const reservations = yield* WorkspaceReservationRepository;
    const recoveries = yield* LatePaymentRecoveryRepository;
    const attempts = yield* PaymentAttemptRepository;
    const now = yield* currentInstant;
    const order = yield* reservations.findById(request.orderId);
    const newestAttemptId = (yield* attempts.findNewestForReservation(
      request.orderId
    ))?.id;
    if (
      !order ||
      !isRetriedOrder(order, request.retriedAttemptId, newestAttemptId)
    ) {
      return refused("not_retryable");
    }
    const recovery = yield* recoveries.findLatestByWorkspaceReservationId(
      order.id
    );
    if (recovery) return refused("not_retryable");

    const kept = yield* keepLiveHold({
      order,
      retriedAttemptId: request.retriedAttemptId,
      now,
    });
    if (kept) return kept;

    const releaseRefusal = yield* releaseOwnHold(order);
    if (releaseRefusal) return releaseRefusal;

    const released = yield* reservations.findById(order.id);
    if (
      !released ||
      !isRetriedOrder(released, request.retriedAttemptId, newestAttemptId) ||
      !isReacquirable(released)
    ) {
      return refused("not_retryable");
    }
    return yield* bookAgain({ order: released, request, now });
  },
  (effect, request) =>
    effect.pipe(
      WorkspaceLockSections.reservationOrder(request.orderId),
      Effect.scoped,
      Effect.tap((result) =>
        Effect.logInfo("Payment retry hold decided", {
          kind: result.kind,
          ...(result.kind === "refused" && { reason: result.reason }),
        })
      ),
      Effect.annotateLogs({
        orderId: request.orderId,
        retriedAttemptId: request.retriedAttemptId,
      })
    )
);

/** What securing a retry's hold reads and writes. */
const retryHoldCapabilities = [
  WorkspaceReservationRepository,
  LatePaymentRecoveryRepository,
  PaymentAttemptRepository,
  UnpaidHoldRelease,
  DotyposService,
  WorkspaceAvailabilityService,
  WorkspaceTableAssignmentService,
  ReservationHoldCleanupScheduleService,
  WorkspaceDatabaseAdvisoryLock,
] as const;

type RetryHoldCapabilities =
  | WorkspaceReservationRepository
  | LatePaymentRecoveryRepository
  | PaymentAttemptRepository
  | UnpaidHoldRelease
  | DotyposService
  | WorkspaceAvailabilityService
  | WorkspaceTableAssignmentService
  | ReservationHoldCleanupScheduleService
  | WorkspaceDatabaseAdvisoryLock;

export interface IPaymentRetryHoldService {
  /**
   * Secures the hold of an order whose payment failed, was cancelled or
   * expired, for the customer to pay it again: keeps the order's live hold,
   * or releases its expired one and books the same reservation again for the
   * same order, through the ordinary availability check and table
   * assignment. Either way the retried attempt stops being the order's
   * active one, so a late payment on its page settles as a refund and never
   * touches this hold. Runs in the order's lock section; Dotypos calls run
   * outside any transaction.
   */
  readonly secure: (
    request: PaymentRetryHoldRequest
  ) => Effect.Effect<PaymentRetryHold, Effect.Error<ReturnType<typeof secure>>>;
}

export class PaymentRetryHoldService extends Context.Service<
  PaymentRetryHoldService,
  IPaymentRetryHoldService
>()("@deskohub-workspace/checkout/PaymentRetryHoldService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const context = Context.pick(...retryHoldCapabilities)(
        yield* Effect.context<RetryHoldCapabilities>()
      );
      return PaymentRetryHoldService.of({
        secure: (request) =>
          secure(request).pipe(Effect.provideContext(context)),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(UnpaidHoldRelease.Default),
    Layer.provide(
      Layer.mergeAll(
        WorkspaceReservationRepository.Default,
        LatePaymentRecoveryRepository.Default,
        PaymentAttemptRepository.Default
      ).pipe(Layer.provide(WorkspaceDatabase.Default))
    ),
    Layer.provide(WorkspaceAvailabilityService.Live),
    Layer.provide(
      WorkspaceTableAssignmentService.Default.pipe(
        Layer.provide(WorkspaceReservationRepository.Live),
        Layer.provide(WorkspaceDotyposLayer)
      )
    ),
    Layer.provide(ReservationHoldCleanupScheduleService.Live),
    Layer.provide(WorkspaceDatabaseAdvisoryLock.Default),
    Layer.provide(WorkspaceDotyposLayer)
  );
}
