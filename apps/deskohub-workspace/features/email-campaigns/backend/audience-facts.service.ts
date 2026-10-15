import "server-only";

import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import type { ReservationProductFilterType } from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Match, Schema } from "effect";
import { reservationIntervalSchema } from "@/features/reservation/reservation-interval";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  type AudienceCountRequest,
  type AudienceDateFacts,
  type AudienceDateRequest,
  type AudienceFacts,
  type AudienceFilter,
  audienceFactKey,
  collectAudienceFactRequests,
} from "../audience-filter";
import {
  type DatePeriodBounds,
  datePeriodBounds,
  isWithinDatePeriodBounds,
} from "../date-period";
import { CampaignRecipientResolutionError } from "../errors";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";

/**
 * Visit queries start this long before the earliest Workspace reservation
 * was created, so a reservation that began shortly before it was booked
 * still counts.
 */
const visitLowerBoundMargin = { days: 7 } as const;

export interface IAudienceFactsService {
  /**
   * Resolves every count and date attribute the filter uses, as of `now`.
   * Visit dates come only from bounded Dotypos range queries: each starts at
   * the period's own start or, when it has none, just before the earliest
   * Workspace reservation, and last-visit queries end at `now`.
   */
  readonly resolve: (input: {
    readonly filter: AudienceFilter;
    readonly now: Temporal.Instant;
  }) => Effect.Effect<AudienceFacts, CampaignRecipientResolutionError>;
}

const decodeInterval = Schema.decodeUnknownEffect(reservationIntervalSchema);

/** The Dotypos start of a reservation, decoded through the interval schema. */
const visitStart = (reservation: DotyposReservation) =>
  decodeInterval({
    startsAt: reservation.startDate,
    endsAt: reservation.endDate,
  }).pipe(
    Effect.map(({ startsAt }) => Temporal.Instant.from(startsAt)),
    Effect.mapError(CampaignRecipientResolutionError.dotypos)
  );

export class AudienceFactsService extends Context.Service<
  AudienceFactsService,
  IAudienceFactsService
>()("@deskohub-workspace/email-campaigns/AudienceFactsService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const candidates = yield* CampaignCandidateRepository;
      const dotypos = yield* DotyposService;

      const database = CampaignRecipientResolutionError.database;

      /** Where visit queries without their own start begin; none without reservations. */
      const visitLowerBound = candidates.earliestReservationAt.pipe(
        Effect.map((createdAt) =>
          createdAt
            ?.toZonedDateTimeISO("UTC")
            .subtract(visitLowerBoundMargin)
            .toInstant()
        ),
        Effect.mapError(database)
      );

      /** Dotypos reservations starting in the bounds, any status. */
      const listVisits = (bounds: {
        readonly startsAtOrAfter: Temporal.Instant;
        readonly startsBefore?: Temporal.Instant;
      }) =>
        dotypos
          .listReservations({
            startsAtOrAfter: bounds.startsAtOrAfter.toString(),
            ...(bounds.startsBefore && {
              startsBefore: bounds.startsBefore.toString(),
            }),
          })
          .pipe(Effect.mapError(CampaignRecipientResolutionError.dotypos));

      const dotyposReservationIds = (
        reservations: readonly DotyposReservation[]
      ) => reservations.flatMap(({ id }) => (id === undefined ? [] : [id]));

      const countResolver = (
        request: AudienceCountRequest,
        now: Temporal.Instant
      ) =>
        Match.value(request).pipe(
          Match.discriminatorsExhaustive("attribute")({
            reservationCount: ({
              params: { dateBasis, period, status, product },
            }) => {
              const bounds = datePeriodBounds(period, now);
              const selection = {
                ...(status && { status }),
                ...(product && { product }),
              };
              if (dateBasis === "booking") {
                return candidates
                  .countReservations({ ...selection, booked: bounds })
                  .pipe(Effect.mapError(database));
              }
              if (period._tag === "AnyTime") {
                return candidates
                  .countReservations(selection)
                  .pipe(Effect.mapError(database));
              }
              return visitLowerBound.pipe(
                Effect.flatMap((lowerBound) => {
                  const startsAtOrAfter = bounds.startsAtOrAfter ?? lowerBound;
                  return startsAtOrAfter === undefined
                    ? Effect.succeed([])
                    : listVisits({ ...bounds, startsAtOrAfter });
                }),
                Effect.flatMap((visits) =>
                  candidates
                    .countReservations({
                      ...selection,
                      dotyposReservationIds: dotyposReservationIds(visits),
                    })
                    .pipe(Effect.mapError(database))
                )
              );
            },
            campaignEmailCount: ({ params: { purpose, period } }) =>
              candidates
                .countReceivedCampaignEmails({
                  ...(purpose !== "any" && { purpose }),
                  dispatched: datePeriodBounds(period, now),
                })
                .pipe(Effect.mapError(database)),
          })
        );

      /**
       * Every visit that has begun by `now`, with its start. One query covers
       * every last-visit condition: from just before the earliest Workspace
       * reservation up to `now`.
       */
      const loadPastVisits = (now: Temporal.Instant) =>
        visitLowerBound.pipe(
          Effect.flatMap((startsAtOrAfter) =>
            startsAtOrAfter === undefined
              ? Effect.succeed([])
              : listVisits({ startsAtOrAfter, startsBefore: now })
          ),
          Effect.flatMap((visits) =>
            Effect.forEach(visits, (visit) =>
              visitStart(visit).pipe(
                Effect.map((startsAt) => [visit.id, startsAt] as const)
              )
            )
          ),
          Effect.map(
            (starts) =>
              new Map(
                starts.flatMap(([id, startsAt]) =>
                  id === undefined ? [] : [[id, startsAt] as const]
                )
              )
          )
        );

      /** Each customer's latest booked visit among the past visits, of the product if given. */
      const lastVisitsOf = (
        startById: ReadonlyMap<DotyposReservationId, Temporal.Instant>,
        product: ReservationProductFilterType | undefined
      ) =>
        candidates.listBookedReservations([...startById.keys()], product).pipe(
          Effect.mapError(database),
          Effect.map((booked) => {
            const lastVisits = new Map<DotyposCustomerId, Temporal.Instant>();
            for (const { dotyposReservationId, dotyposCustomerId } of booked) {
              const startsAt = startById.get(dotyposReservationId);
              const latest = lastVisits.get(dotyposCustomerId);
              if (
                startsAt &&
                (!latest || Temporal.Instant.compare(startsAt, latest) > 0)
              ) {
                lastVisits.set(dotyposCustomerId, startsAt);
              }
            }
            return lastVisits;
          })
        );

      const datesFrom = (
        values: ReadonlyMap<DotyposCustomerId, Temporal.Instant>,
        bounds: DatePeriodBounds
      ): AudienceDateFacts => ({
        withValue: new Set(values.keys()),
        inPeriod: new Set(
          [...values].flatMap(([id, value]) =>
            isWithinDatePeriodBounds(bounds, value) ? [id] : []
          )
        ),
      });

      return {
        resolve: Effect.fn("AudienceFactsService.resolve")(function* ({
          filter,
          now,
        }) {
          const requests = collectAudienceFactRequests(filter);
          const pastVisits = yield* Effect.cached(loadPastVisits(now));

          const dateResolver = (request: AudienceDateRequest) => {
            const bounds = datePeriodBounds(request.period, now);
            return Match.value(request.attribute).pipe(
              Match.when("lastVisit", () =>
                pastVisits.pipe(
                  Effect.flatMap((starts) =>
                    lastVisitsOf(starts, request.product)
                  ),
                  Effect.map((values) => datesFrom(values, bounds))
                )
              ),
              Match.when("accountCreated", () =>
                candidates
                  .accountCreations(bounds)
                  .pipe(Effect.mapError(database))
              ),
              Match.exhaustive
            );
          };

          return yield* Effect.all({
            counts: Effect.forEach(requests.counts, (request) =>
              countResolver(request, now).pipe(
                Effect.map(
                  (counts) => [audienceFactKey(request), counts] as const
                )
              )
            ).pipe(Effect.map((entries) => new Map(entries))),
            dates: Effect.forEach(requests.dates, (request) =>
              dateResolver(request).pipe(
                Effect.map(
                  (dates) => [audienceFactKey(request), dates] as const
                )
              )
            ).pipe(Effect.map((entries) => new Map(entries))),
          });
        }),
      } satisfies IAudienceFactsService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(CampaignCandidateRepository.Live, WorkspaceDotyposLayer)
    )
  );
}
