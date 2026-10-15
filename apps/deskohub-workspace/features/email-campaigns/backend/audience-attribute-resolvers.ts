import type {
  DotyposCustomer,
  DotyposCustomerId,
  DotyposReservation,
  DotyposReservationId,
} from "@deskohub/dotypos";
import type {
  AudienceAttributeCatalogue,
  AudienceAttributeDefinition,
  AudienceConditionIn,
  AudienceConditionOf,
  ReservationProductFilterType,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import type { AudienceCandidate, AudienceDateFacts } from "../audience-filter";
import {
  type DatePeriodBounds,
  datePeriodBounds,
  isWithinDatePeriodBounds,
} from "../date-period";
import { CampaignRecipientResolutionError } from "../errors";
import type { ICampaignCandidateRepository } from "./campaign-candidate.repository";

/** What a resolver can query while resolving one audience as of `now`. */
export type AudienceResolution = {
  readonly now: Temporal.Instant;
  readonly candidates: ICampaignCandidateRepository;
  /**
   * Dotypos reservations, any status, starting in the bounds. Without a
   * start of its own the query starts just before the earliest Workspace
   * reservation, so it never reads unbounded history.
   */
  readonly visitsIn: (
    bounds: DatePeriodBounds
  ) => Resolved<readonly DotyposReservation[]>;
  /** Every Dotypos reservation that has begun by `now`, with its start. */
  readonly pastVisits: Resolved<
    ReadonlyMap<DotyposReservationId, Temporal.Instant>
  >;
};

type Resolved<Value> = Effect.Effect<Value, CampaignRecipientResolutionError>;

/** Counts each customer's records for a count condition's params. */
export type AudienceCountResolver<Params> = {
  readonly count: (
    params: Params,
    resolution: AudienceResolution
  ) => Resolved<ReadonlyMap<DotyposCustomerId, number>>;
};

/** Customers with a date value, and those whose value lies in the bounds. */
type AudienceDateResolver = {
  readonly dates: (
    request: {
      readonly bounds: DatePeriodBounds;
      readonly product?: ReservationProductFilterType;
    },
    resolution: AudienceResolution
  ) => Resolved<AudienceDateFacts>;
};

/**
 * Reads a set or boolean attribute from what Workspace knows locally, or
 * from the Dotypos profile, which is `unknown` until it is loaded.
 */
export type AudienceValueResolver<Value> =
  | {
      readonly from: "candidate";
      readonly read: (candidate: AudienceCandidate) => Value;
    }
  | {
      readonly from: "profile";
      readonly read: (customer: DotyposCustomer) => Value;
    };

type CatalogueEntries = {
  readonly [Attribute in string]: AudienceAttributeDefinition;
};

type AttributeOfKindIn<
  Catalogue extends CatalogueEntries,
  Kind extends AudienceAttributeDefinition["kind"],
> = {
  readonly [Attribute in keyof Catalogue]: Catalogue[Attribute]["kind"] extends Kind
    ? Attribute
    : never;
}[keyof Catalogue];

type ConditionIn<
  Catalogue extends CatalogueEntries,
  Attribute extends keyof Catalogue,
> = Extract<AudienceConditionIn<Catalogue>, { readonly attribute: Attribute }>;

/** The params of a count attribute's conditions. */
export type AudienceCountParams<
  Attribute extends keyof Catalogue,
  Catalogue extends CatalogueEntries = AudienceAttributeCatalogue,
> =
  ConditionIn<Catalogue, Attribute> extends { readonly params: infer Params }
    ? Params
    : never;

type ValueIn<
  Catalogue extends CatalogueEntries,
  Attribute extends keyof Catalogue,
> =
  ConditionIn<Catalogue, Attribute> extends { readonly value: infer Value }
    ? Value
    : never;

/**
 * One resolver per catalogued attribute, of its kind's shape. An attribute
 * added to the catalogue without a resolver fails the typecheck here.
 */
export type AudienceAttributeResolvers<
  Catalogue extends CatalogueEntries = AudienceAttributeCatalogue,
> = {
  readonly [Attribute in AttributeOfKindIn<
    Catalogue,
    "count"
  >]: AudienceCountResolver<AudienceCountParams<Attribute, Catalogue>>;
} & {
  readonly [Attribute in AttributeOfKindIn<
    Catalogue,
    "date"
  >]: AudienceDateResolver;
} & {
  readonly [Attribute in AttributeOfKindIn<
    Catalogue,
    "set" | "boolean"
  >]: AudienceValueResolver<ValueIn<Catalogue, Attribute>>;
};

const database = CampaignRecipientResolutionError.database;

const reservationIds = (reservations: readonly DotyposReservation[]) =>
  reservations.flatMap(({ id }) => (id === undefined ? [] : [id]));

/**
 * Booked reservations by booking date count from local data; by visit date
 * in a bounded period they count among the Dotypos reservations starting in
 * it; by visit date at any time every booked reservation counts.
 */
const countReservations = (
  {
    dateBasis,
    period,
    status,
    product,
  }: AudienceConditionOf<"reservationCount">["params"],
  { candidates, now, visitsIn }: AudienceResolution
) => {
  const selection = { ...(status && { status }), ...(product && { product }) };
  const bounds = datePeriodBounds(period, now);
  const countSelected = (
    extra: Pick<
      Parameters<ICampaignCandidateRepository["countReservations"]>[0],
      "booked" | "dotyposReservationIds"
    >
  ) =>
    candidates
      .countReservations({ ...selection, ...extra })
      .pipe(Effect.mapError(database));
  return Match.value({ dateBasis, period }).pipe(
    Match.when({ dateBasis: "booking" }, () =>
      countSelected({ booked: bounds })
    ),
    Match.when({ period: { _tag: "AnyTime" } }, () => countSelected({})),
    Match.orElse(() =>
      visitsIn(bounds).pipe(
        Effect.flatMap((visits) =>
          countSelected({ dotyposReservationIds: reservationIds(visits) })
        )
      )
    )
  );
};

/** Each customer's latest booked visit among the past visits, of the product if given. */
const lastVisits = (
  { bounds, product }: Parameters<AudienceDateResolver["dates"]>[0],
  { candidates, pastVisits }: AudienceResolution
) =>
  pastVisits.pipe(
    Effect.flatMap((startById) =>
      candidates.listBookedReservations([...startById.keys()], product).pipe(
        Effect.mapError(database),
        Effect.map((booked) => {
          const latestByCustomer = new Map<
            DotyposCustomerId,
            Temporal.Instant
          >();
          for (const { dotyposReservationId, dotyposCustomerId } of booked) {
            const startsAt = startById.get(dotyposReservationId);
            const latest = latestByCustomer.get(dotyposCustomerId);
            if (
              startsAt &&
              (!latest || Temporal.Instant.compare(startsAt, latest) > 0)
            ) {
              latestByCustomer.set(dotyposCustomerId, startsAt);
            }
          }
          return latestByCustomer;
        })
      )
    ),
    Effect.map(
      (latest): AudienceDateFacts => ({
        withValue: new Set(latest.keys()),
        inPeriod: new Set(
          [...latest].flatMap(([id, startsAt]) =>
            isWithinDatePeriodBounds(bounds, startsAt) ? [id] : []
          )
        ),
      })
    )
  );

/**
 * How Workspace resolves each catalogued attribute. Count and date
 * attributes query local data and bounded Dotypos ranges once per audience;
 * set and boolean attributes read each candidate.
 */
export const audienceAttributeResolvers: AudienceAttributeResolvers = {
  reservationCount: { count: countReservations },
  campaignEmailCount: {
    count: ({ purpose, period }, { candidates, now }) =>
      candidates
        .countReceivedCampaignEmails({
          ...(purpose !== "any" && { purpose }),
          dispatched: datePeriodBounds(period, now),
        })
        .pipe(Effect.mapError(database)),
  },
  lastVisit: { dates: lastVisits },
  accountCreated: {
    dates: ({ bounds }, { candidates }) =>
      candidates.accountCreations(bounds).pipe(Effect.mapError(database)),
  },
  locale: { from: "candidate", read: ({ locale }) => [locale] },
  dotyposTags: { from: "profile", read: ({ tags }) => tags ?? [] },
  discountGroup: {
    from: "profile",
    read: ({ _discountGroupId }) =>
      _discountGroupId ? [_discountGroupId] : [],
  },
  hasAccount: { from: "candidate", read: ({ hasAccount }) => hasAccount },
};
