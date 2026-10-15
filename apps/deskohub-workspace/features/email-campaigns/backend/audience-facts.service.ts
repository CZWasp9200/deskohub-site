import "server-only";

import { type DotyposReservation, DotyposService } from "@deskohub/dotypos";
import type { AudienceAttributeOfKind } from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { reservationIntervalSchema } from "@/features/reservation/reservation-interval";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  type AudienceCountRequest,
  type AudienceDateRequest,
  type AudienceFacts,
  type AudienceFilter,
  audienceFactKey,
  collectAudienceFactRequests,
} from "../audience-filter";
import { type DatePeriodBounds, datePeriodBounds } from "../date-period";
import { CampaignRecipientResolutionError } from "../errors";
import {
  type AudienceCountParams,
  type AudienceCountResolver,
  type AudienceResolution,
  audienceAttributeResolvers,
} from "./audience-attribute-resolvers";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";

/**
 * Visit queries start this long before the earliest Workspace reservation
 * was created, so a reservation that began shortly before it was booked
 * still counts.
 */
const visitLowerBoundMargin = { days: 7 } as const;

export interface IAudienceFactsService {
  /**
   * Resolves every count and date attribute the filter uses, as of `now`,
   * through each attribute's resolver. Visit dates come only from bounded
   * Dotypos range queries: each starts at the period's own start or, when it
   * has none, just before the earliest Workspace reservation, and last-visit
   * queries end at `now`, inclusive.
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

/**
 * The exclusive end of a Dotypos start-date query. Dotypos filters have no
 * inclusive upper bound, and its start dates carry at most millisecond
 * precision, so "at or before t" asks for "before t + 1 ms".
 */
const dotyposStartsBefore = (bounds: DatePeriodBounds) =>
  bounds.startsAtOrBefore?.add({ milliseconds: 1 }) ?? bounds.startsBefore;

/** The count resolvers, keyed so a request's attribute picks its params' resolver. */
const countResolvers: {
  readonly [Attribute in AudienceAttributeOfKind<"count">]: AudienceCountResolver<
    AudienceCountParams<Attribute>
  >;
} = audienceAttributeResolvers;

/** Counts through the request's attribute resolver. */
const resolveCount = <Attribute extends AudienceAttributeOfKind<"count">>(
  request: {
    readonly attribute: Attribute;
    readonly params: AudienceCountParams<Attribute>;
  },
  resolution: AudienceResolution
) => countResolvers[request.attribute].count(request.params, resolution);

/** Dates through the request's attribute resolver. */
const resolveDates = (
  { attribute, period, product }: AudienceDateRequest,
  resolution: AudienceResolution
) =>
  audienceAttributeResolvers[attribute].dates(
    {
      bounds: datePeriodBounds(period, resolution.now),
      ...(product && { product }),
    },
    resolution
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

      /** Where visit queries without their own start begin; none without reservations. */
      const visitLowerBound = candidates.earliestReservationAt.pipe(
        Effect.map((createdAt) =>
          createdAt
            ?.toZonedDateTimeISO("UTC")
            .subtract(visitLowerBoundMargin)
            .toInstant()
        ),
        Effect.mapError(CampaignRecipientResolutionError.database)
      );

      const visitsIn = (bounds: DatePeriodBounds) =>
        visitLowerBound.pipe(
          Effect.map((lowerBound) => bounds.startsAtOrAfter ?? lowerBound),
          Effect.flatMap((startsAtOrAfter) =>
            startsAtOrAfter === undefined
              ? Effect.succeed([])
              : dotypos
                  .listReservations({
                    startsAtOrAfter: startsAtOrAfter.toString(),
                    ...Option.match(
                      Option.fromNullishOr(dotyposStartsBefore(bounds)),
                      {
                        onNone: () => ({}),
                        onSome: (startsBefore) => ({
                          startsBefore: startsBefore.toString(),
                        }),
                      }
                    ),
                  })
                  .pipe(
                    Effect.mapError(CampaignRecipientResolutionError.dotypos)
                  )
          )
        );

      /** Every visit that has begun by `now`, with its start, in one query. */
      const pastVisits = (now: Temporal.Instant) =>
        visitsIn({ startsAtOrBefore: now }).pipe(
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

      const keyed = <
        Request extends AudienceCountRequest | AudienceDateRequest,
        Value,
      >(
        requests: readonly Request[],
        resolve: (
          request: Request
        ) => Effect.Effect<Value, CampaignRecipientResolutionError>
      ) =>
        Effect.forEach(requests, (request) =>
          resolve(request).pipe(
            Effect.map((value) => [audienceFactKey(request), value] as const)
          )
        ).pipe(Effect.map((entries) => new Map(entries)));

      return {
        resolve: ({ filter, now }) =>
          Effect.Do.pipe(
            Effect.let("requests", () => collectAudienceFactRequests(filter)),
            Effect.bind("pastVisits", () => Effect.cached(pastVisits(now))),
            Effect.let(
              "resolution",
              ({ pastVisits }): AudienceResolution => ({
                now,
                candidates,
                visitsIn,
                pastVisits,
              })
            ),
            Effect.bind("facts", ({ requests, resolution }) =>
              Effect.all({
                counts: keyed(requests.counts, (request) =>
                  resolveCount(request, resolution)
                ),
                dates: keyed(requests.dates, (request) =>
                  resolveDates(request, resolution)
                ),
              })
            ),
            Effect.map(({ facts }) => facts),
            Effect.withSpan("AudienceFactsService.resolve")
          ),
      } satisfies IAudienceFactsService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(CampaignCandidateRepository.Live, WorkspaceDotyposLayer)
    )
  );
}
