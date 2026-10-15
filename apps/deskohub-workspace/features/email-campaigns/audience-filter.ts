import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import {
  type AudienceAttributeOfKind,
  type AudienceConditionOf,
  type AudienceConditionType,
  type AudienceCountOperatorType,
  type AudienceFilterGroup,
  type AudienceFilterType,
  type AudienceSetOperatorType,
  AudienceFilter as audienceFilterContractSchema,
  type ReservationProductFilterType,
} from "@deskohub/workspace-admin-api";
import { Match, Option, Schema } from "effect";
import { type Locale, locales } from "@/features/i18n";
import { reservationProductFilterSchema } from "@/features/reservation/reservation-product-descriptor";
import type { DatePeriod } from "./date-period";

/**
 * The filter tree a campaign audience selects its recipients with. The
 * administration contract defines it, with its attribute catalogue, once for
 * Workspace, the Admin UI, and `dhw`.
 */
export type AudienceFilter = AudienceFilterType;
export type AudienceCondition = AudienceConditionType;
export type { AudienceFilterGroup };

type AudienceCountAttribute = AudienceAttributeOfKind<"count">;
type AudienceDateAttribute = AudienceAttributeOfKind<"date">;

/**
 * Three-valued result: a Dotypos condition is `unknown` until the customer's
 * profile is loaded, so local conditions can drop candidates before any
 * Dotypos request.
 */
export type AudienceFilterOutcome = "match" | "noMatch" | "unknown";

/** Locally known facts about one candidate customer. */
export type AudienceCandidate = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly hasAccount: boolean;
};

/** What one count condition counts; equal requests share one lookup. */
export type AudienceCountRequest = {
  readonly [Attribute in AudienceCountAttribute]: Pick<
    AudienceConditionOf<Attribute>,
    "attribute" | "params"
  >;
}[AudienceCountAttribute];

/** Which date attribute one condition tests, in which period. */
export type AudienceDateRequest = {
  readonly attribute: AudienceDateAttribute;
  readonly period: DatePeriod;
  /** Only reservations of this product count (last visit). */
  readonly product?: ReservationProductFilterType;
};

/** Customers whose date attribute has a value, and whose value is in the period. */
export type AudienceDateFacts = {
  readonly withValue: ReadonlySet<DotyposCustomerId>;
  readonly inPeriod: ReadonlySet<DotyposCustomerId>;
};

/**
 * Resolved count and date attributes, keyed by {@link audienceFactKey}. A
 * candidate missing from a count map has a count of zero, so "= 0" and "< N"
 * match customers without any records.
 */
export type AudienceFacts = {
  readonly counts: ReadonlyMap<string, ReadonlyMap<DotyposCustomerId, number>>;
  readonly dates: ReadonlyMap<string, AudienceDateFacts>;
};

/** Requests are decoded schema values, so their key order is stable. */
export const audienceFactKey = (
  request: AudienceCountRequest | AudienceDateRequest
): string => JSON.stringify(request);

const anyTime: DatePeriod = { _tag: "AnyTime" };

/** "Has no value" needs only the customers with one, so it asks for any time. */
const dateRequest = (
  condition: AudienceConditionOf<AudienceDateAttribute>
): AudienceDateRequest => ({
  attribute: condition.attribute,
  period: condition.operator === "none" ? anyTime : condition.value,
  ...("params" in condition &&
    condition.params && { product: condition.params.product }),
});

const countRequest = (
  condition: AudienceConditionOf<AudienceCountAttribute>
): AudienceCountRequest =>
  ({
    attribute: condition.attribute,
    params: condition.params,
  }) as AudienceCountRequest;

const conditionsOf = (filter: AudienceFilter): readonly AudienceCondition[] =>
  filter._tag === "Group" ? filter.filters.flatMap(conditionsOf) : [filter];

/** Every count and date lookup the tree needs, deduplicated. */
export const collectAudienceFactRequests = (
  filter: AudienceFilter
): {
  readonly counts: readonly AudienceCountRequest[];
  readonly dates: readonly AudienceDateRequest[];
} => {
  const counts = new Map<string, AudienceCountRequest>();
  const dates = new Map<string, AudienceDateRequest>();
  for (const condition of conditionsOf(filter)) {
    Match.value(condition).pipe(
      Match.discriminatorsExhaustive("attribute")({
        reservationCount: (count) => {
          const request = countRequest(count);
          counts.set(audienceFactKey(request), request);
        },
        campaignEmailCount: (count) => {
          const request = countRequest(count);
          counts.set(audienceFactKey(request), request);
        },
        lastVisit: (date) => {
          const request = dateRequest(date);
          dates.set(audienceFactKey(request), request);
        },
        accountCreated: (date) => {
          const request = dateRequest(date);
          dates.set(audienceFactKey(request), request);
        },
        locale: () => undefined,
        dotyposTags: () => undefined,
        discountGroup: () => undefined,
        hasAccount: () => undefined,
      })
    );
  }
  return { counts: [...counts.values()], dates: [...dates.values()] };
};

/** Compares a count with a condition's number. */
export const compareCount = (
  operator: AudienceCountOperatorType,
  actual: number,
  expected: number
): boolean =>
  Match.value(operator).pipe(
    Match.when("eq", () => actual === expected),
    Match.when("ne", () => actual !== expected),
    Match.when("lt", () => actual < expected),
    Match.when("lte", () => actual <= expected),
    Match.when("gt", () => actual > expected),
    Match.when("gte", () => actual >= expected),
    Match.exhaustive
  );

/** Compares an attribute's values with a condition's chosen values. */
export const matchesSet = <Value>(
  operator: AudienceSetOperatorType,
  actual: readonly Value[],
  selected: readonly Value[]
): boolean =>
  Match.value(operator).pipe(
    Match.when("anyOf", () => selected.some((value) => actual.includes(value))),
    Match.when("allOf", () =>
      selected.every((value) => actual.includes(value))
    ),
    Match.when(
      "noneOf",
      () => !selected.some((value) => actual.includes(value))
    ),
    Match.exhaustive
  );

const fromBoolean = (value: boolean): AudienceFilterOutcome =>
  value ? "match" : "noMatch";

/**
 * Evaluates the filter for one candidate. Pass `Option.none()` as the profile
 * before Dotypos hydration; Dotypos conditions then evaluate to `unknown`.
 */
export const evaluateAudienceFilter = (input: {
  readonly filter: AudienceFilter;
  readonly candidate: AudienceCandidate;
  readonly facts: AudienceFacts;
  readonly profile: Option.Option<DotyposCustomer>;
}): AudienceFilterOutcome => {
  const { candidate, facts, profile } = input;
  const profileCondition = (
    predicate: (customer: DotyposCustomer) => boolean
  ): AudienceFilterOutcome =>
    Option.match(profile, {
      onNone: () => "unknown",
      onSome: (customer) => fromBoolean(predicate(customer)),
    });

  const countCondition = (
    condition: AudienceConditionOf<AudienceCountAttribute>
  ) =>
    fromBoolean(
      compareCount(
        condition.operator,
        facts.counts
          .get(audienceFactKey(countRequest(condition)))
          ?.get(candidate.dotyposCustomerId) ?? 0,
        condition.value
      )
    );

  const dateCondition = (
    condition: AudienceConditionOf<AudienceDateAttribute>
  ) => {
    const dates = facts.dates.get(audienceFactKey(dateRequest(condition)));
    const id = candidate.dotyposCustomerId;
    const hasValue = dates?.withValue.has(id) ?? false;
    const inPeriod = dates?.inPeriod.has(id) ?? false;
    return fromBoolean(
      Match.value(condition.operator).pipe(
        Match.when("in", () => inPeriod),
        Match.when("notIn", () => hasValue && !inPeriod),
        Match.when("none", () => !hasValue),
        Match.exhaustive
      )
    );
  };

  const evaluateCondition = (
    condition: AudienceCondition
  ): AudienceFilterOutcome =>
    Match.value(condition).pipe(
      Match.discriminatorsExhaustive("attribute")({
        reservationCount: countCondition,
        campaignEmailCount: countCondition,
        lastVisit: dateCondition,
        accountCreated: dateCondition,
        locale: ({ operator, value }) =>
          fromBoolean(matchesSet(operator, [candidate.locale], value)),
        dotyposTags: ({ operator, value }) =>
          profileCondition((customer) =>
            matchesSet(operator, customer.tags ?? [], value)
          ),
        discountGroup: ({ operator, value }) =>
          profileCondition((customer) =>
            matchesSet(
              operator,
              customer._discountGroupId ? [customer._discountGroupId] : [],
              value
            )
          ),
        hasAccount: ({ value }) => fromBoolean(candidate.hasAccount === value),
      })
    );

  const evaluate = (filter: AudienceFilter): AudienceFilterOutcome =>
    filter._tag === "Group"
      ? combineOutcomes(filter.operator, filter.filters.map(evaluate))
      : evaluateCondition(filter);

  return evaluate(input.filter);
};

const combineOutcomes = (
  operator: AudienceFilterGroup["operator"],
  outcomes: readonly AudienceFilterOutcome[]
): AudienceFilterOutcome => {
  const decisive = operator === "and" ? "noMatch" : "match";
  if (outcomes.includes(decisive)) return decisive;
  if (outcomes.includes("unknown")) return "unknown";
  return operator === "and" ? "match" : "noMatch";
};

const allLocales = (): ReadonlySet<Locale> => new Set(locales);

/**
 * The locales a recipient of the audience can have. Only locale conditions
 * narrow it: an AND group keeps the locales all its filters allow and an OR
 * group the locales any of them allows. An empty AND group matches everyone
 * and an empty OR group nobody, as {@link evaluateAudienceFilter} decides.
 */
export const audienceLocales = (filter: AudienceFilter): ReadonlySet<Locale> =>
  filter._tag === "Group"
    ? groupLocales(filter)
    : Match.value(filter).pipe(
        Match.discriminatorsExhaustive("attribute")({
          locale: ({ operator, value }) =>
            new Set(
              locales.filter((locale) => matchesSet(operator, [locale], value))
            ),
          reservationCount: allLocales,
          campaignEmailCount: allLocales,
          lastVisit: allLocales,
          accountCreated: allLocales,
          dotyposTags: allLocales,
          discountGroup: allLocales,
          hasAccount: allLocales,
        })
      );

const groupLocales = ({
  operator,
  filters,
}: AudienceFilterGroup): ReadonlySet<Locale> => {
  const allowed = filters.map(audienceLocales);
  return new Set(
    locales.filter((locale) =>
      operator === "and"
        ? allowed.every((group) => group.has(locale))
        : allowed.some((group) => group.has(locale))
    )
  );
};

/**
 * The single locale every recipient of the audience has, when its filter
 * allows only one. Campaign content then needs only that locale.
 */
export const audienceSingleLocale = (
  filter: AudienceFilter
): Locale | undefined => {
  const [locale, ...others] = audienceLocales(filter);
  return others.length === 0 ? locale : undefined;
};

/** The product filters of the tree's reservation-based conditions. */
const productFilters = (
  filter: AudienceFilter
): readonly ReservationProductFilterType[] =>
  conditionsOf(filter).flatMap((condition) =>
    Match.value(condition).pipe(
      Match.discriminatorsExhaustive("attribute")({
        reservationCount: ({ params }) =>
          params.product ? [params.product] : [],
        lastVisit: (date) => (date.params ? [date.params.product] : []),
        campaignEmailCount: () => [],
        accountCreated: () => [],
        locale: () => [],
        dotyposTags: () => [],
        discountGroup: () => [],
        hasAccount: () => [],
      })
    )
  );

const isCatalogProductFilter = Schema.is(reservationProductFilterSchema);

/**
 * The contract's filter schema, plus a check that every product filter names
 * a property of its family's catalog with a valid operator and values. The
 * Admin UI, the administration API, and stored filters all decode with it.
 */
export const audienceFilterSchema = audienceFilterContractSchema.check(
  Schema.makeFilter(
    (filter: AudienceFilter) =>
      productFilters(filter).every(isCatalogProductFilter),
    {
      message:
        "Reservation product conditions must name a catalog property with a valid value.",
    }
  )
);
