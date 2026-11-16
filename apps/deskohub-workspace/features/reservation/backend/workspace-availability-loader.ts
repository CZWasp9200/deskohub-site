import { Effect, Exit, Layer } from "effect";
import { PayState } from "@/features/checkout/backend/checkout/pay-state";
import { PayableCheckout } from "@/features/checkout/backend/checkout/payable-checkout.service";
import { recoverReplacementPayState } from "@/features/checkout/backend/checkout/replacement-pay-state";
import { isReservationSupersedable } from "@/features/reservation/backend/reservation-supersession";
import { meetingRoomReservationKind } from "@/features/reservation/reservation-kind";
import type {
  MeetingRoomStartTimesQuery,
  MeetingRoomUnavailableDatesQuery,
  PreloadedWorkspaceAvailability,
  WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { pagePreload } from "./page-preload";
import { WorkspaceAvailabilityService } from "./workspace-availability.service";
import { recoverReplacementOccupancyExclusion } from "./workspace-availability-replacement";

/** The services availability loads with replacement exclusion depend on. */
export const WorkspaceAvailabilityLoaderLive = Layer.mergeAll(
  WorkspaceAvailabilityService.Live,
  PayableCheckout.Live,
  SealedStateKeys.Default
);

/**
 * The occupancy a replacement may ignore: only the verified current hold of
 * the signed Pay state being replaced, only for the same reservation kind, and
 * only while that hold is still payable and no payment is pending or done. An
 * invalid or foreign replacement excludes nothing; the effect fails only when
 * the current hold cannot be looked up.
 */
const verifyReplacementOccupancyExclusion = Effect.fn(
  "workspaceAvailability.verifyReplacementOccupancyExclusion"
)(function* ({
  kind,
  replacementToken,
}: {
  readonly kind: WorkspaceAvailabilityQuery["kind"];
  readonly replacementToken?: string;
}) {
  const token = replacementToken?.trim();
  if (!token) return undefined;

  const state = yield* PayState.open(token).pipe(recoverReplacementPayState);
  if (!state || state.reservation.kind !== kind) return undefined;

  const payableCheckout = yield* PayableCheckout;
  return yield* payableCheckout.reconfirm(state).pipe(
    Effect.map(({ reservation }) =>
      isReservationSupersedable(reservation)
        ? { dotyposReservationId: reservation.dotyposReservationId }
        : undefined
    ),
    Effect.catchTag("CheckoutUnavailableError", () => Effect.succeed(undefined))
  );
});

/**
 * Advisory availability for one query, excluding a verified replacement.
 * While the replacement's hold cannot be looked up it loads ordinary
 * availability.
 */
export const loadAvailability = Effect.fn("workspaceAvailability.load")(
  function* ({
    query,
    replacementToken,
  }: {
    readonly query: WorkspaceAvailabilityQuery;
    readonly replacementToken?: string;
  }) {
    const occupancyExclusion = yield* verifyReplacementOccupancyExclusion({
      kind: query.kind,
      replacementToken,
    }).pipe(recoverReplacementOccupancyExclusion);
    const service = yield* WorkspaceAvailabilityService;
    return yield* service.getAvailability({ query, occupancyExclusion });
  }
);

/**
 * Advisory free meeting-room starts for one date, excluding a verified
 * replacement like `loadAvailability`.
 */
export const loadMeetingRoomStartTimes = Effect.fn(
  "workspaceAvailability.loadMeetingRoomStartTimes"
)(function* ({
  query,
  replacementToken,
}: {
  readonly query: MeetingRoomStartTimesQuery;
  readonly replacementToken?: string;
}) {
  const occupancyExclusion = yield* verifyReplacementOccupancyExclusion({
    kind: query.kind,
    replacementToken,
  }).pipe(recoverReplacementOccupancyExclusion);
  const service = yield* WorkspaceAvailabilityService;
  return yield* service.getMeetingRoomStartTimes({ query, occupancyExclusion });
});

/**
 * Advisory meeting-room calendar for a date range, excluding a verified
 * replacement like `loadAvailability`.
 */
export const loadMeetingRoomUnavailableDates = Effect.fn(
  "workspaceAvailability.loadMeetingRoomUnavailableDates"
)(function* ({
  query,
  replacementToken,
}: {
  readonly query: MeetingRoomUnavailableDatesQuery;
  readonly replacementToken?: string;
}) {
  const occupancyExclusion = yield* verifyReplacementOccupancyExclusion({
    kind: meetingRoomReservationKind,
    replacementToken,
  }).pipe(recoverReplacementOccupancyExclusion);
  const service = yield* WorkspaceAvailabilityService;
  return yield* service.getMeetingRoomUnavailableDates({
    query,
    occupancyExclusion,
  });
});

type AvailabilityPreload = {
  readonly queries: ReadonlyArray<WorkspaceAvailabilityQuery>;
  readonly replacementToken?: string;
};

/**
 * Availability for the queries a reservation page renders first. A query that
 * fails is omitted for the client to load, so the page never fails on it.
 * All queries share one page kind and replacement.
 */
export const preloadAvailability = Effect.fn("workspaceAvailability.preload")(
  function* ({ queries, replacementToken }: AvailabilityPreload) {
    const [firstQuery] = queries;
    if (!firstQuery) return [];

    // Without the replacement's hold the page would show the customer's own
    // hold as occupied, so it leaves every query to the client, which retries
    // the lookup.
    const exclusionExit = yield* verifyReplacementOccupancyExclusion({
      kind: firstQuery.kind,
      replacementToken,
    }).pipe(Effect.exit);
    if (Exit.isFailure(exclusionExit)) {
      yield* Effect.logWarning(
        "Preloaded workspace availability could not verify the replacement; the client loads it",
        { cause: exclusionExit.cause, kind: firstQuery.kind }
      );
      return [];
    }
    const occupancyExclusion = exclusionExit.value;
    const service = yield* WorkspaceAvailabilityService;
    const results = yield* Effect.forEach(
      queries,
      (query) =>
        service.getAvailability({ query, occupancyExclusion }).pipe(
          Effect.exit,
          Effect.tap((exit) =>
            Exit.isFailure(exit)
              ? Effect.logWarning(
                  "Preloaded workspace availability failed; the client loads it",
                  { cause: exit.cause, kind: query.kind }
                )
              : Effect.void
          ),
          Effect.map(
            Exit.match({
              onFailure: () => [],
              onSuccess: (
                availability
              ): Array<PreloadedWorkspaceAvailability> => [
                { query, availability, loadedAt: Date.now() },
              ],
            })
          )
        ),
      { concurrency: "unbounded" }
    );

    return results.flat();
  }
);

/**
 * The page's availability preload with its live services, bounded by the page
 * preload deadline. Nothing it fails or runs late on, including building those
 * services, fails the page: the client loads whatever is missing.
 */
export const preloadPageAvailability = (input: AvailabilityPreload) =>
  preloadAvailability(input).pipe(
    Effect.provide(WorkspaceAvailabilityLoaderLive),
    Effect.scoped,
    pagePreload("workspace availability")
  );
