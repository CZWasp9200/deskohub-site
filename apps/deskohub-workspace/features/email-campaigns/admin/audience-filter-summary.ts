import type {
  AudienceBooleanAttributeDefinition,
  AudienceBooleanCondition,
  AudienceChoiceOption,
  AudienceCountAttributeDefinition,
  AudienceCountCondition,
  AudienceCountOperatorType,
  AudienceDateAttributeDefinition,
  AudienceDateCondition,
  AudienceSetAttributeDefinition,
  AudienceSetCondition,
  AudienceValueLookup,
  ReservationProductFilterType,
  ReservationProductPropertyCondition,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import {
  reservationProductFamilies,
  reservationProductProperty,
} from "@/features/reservation/reservation-product-descriptor";
import {
  type AudienceFilter,
  audienceConditionsOf,
  viewAudienceCondition,
} from "../audience-filter";
import type { DatePeriod } from "../date-period";
import { describeDatePeriod } from "./date-period-phrases";

/** A looked-up value an audience can filter by, such as a discount group. */
export type AudienceValueOption = {
  readonly id: string;
  readonly name: string;
};

/** A Dotypos discount group an audience can filter by. */
export type DiscountGroupOption = AudienceValueOption;

/** The value lists Workspace looked up; a missing one shows raw values. */
export type AudienceValueLookups = {
  readonly [Lookup in AudienceValueLookup]?:
    | readonly AudienceValueOption[]
    | undefined;
};

type Noun = { readonly one: string; readonly other: string };

/** Comparisons that read naturally: "no emails", "any emails". */
const naturalCounts: Readonly<Record<string, "no" | "any">> = {
  "eq 0": "no",
  "lt 1": "no",
  "gt 0": "any",
  "gte 1": "any",
};

const comparisonWords: Readonly<Record<AudienceCountOperatorType, string>> = {
  eq: "exactly",
  ne: "other than",
  lt: "fewer than",
  lte: "at most",
  gt: "more than",
  gte: "at least",
};

/**
 * The count as it reads in a sentence: "no emails" for "= 0" and "< 1", "any
 * emails" for "> 0" and "≥ 1", otherwise literally: "at least 3 emails",
 * "fewer than 2 emails", "at most 0 emails", ….
 */
export const describeCount = (
  operator: AudienceCountOperatorType,
  value: number,
  noun: Noun
): string => {
  // A half-typed number reads as a gap until the operator finishes it.
  if (!Number.isInteger(value)) return `… ${noun.other}`;
  const natural = naturalCounts[`${operator} ${value}`];
  if (natural) return `${natural} ${noun.other}`;
  return `${comparisonWords[operator]} ${value} ${value === 1 ? noun.one : noun.other}`;
};

/** A product filter around "reservation": names before it, conditions after. */
const productPhrases = (
  product: ReservationProductFilterType | undefined
): { readonly before: string; readonly after: string } => {
  if (!product) return { before: "", after: "" };
  const family = reservationProductFamilies[product.family].label.toLowerCase();
  const names = (property: string, values: readonly string[]) => {
    const descriptor = reservationProductProperty(product.family, property);
    return joined(
      values.map(
        (id) =>
          (descriptor?.kind === "enum" &&
            descriptor.values
              .find((value) => value.id === id)
              ?.name("en-US")) ||
          id
      ),
      " or "
    );
  };
  const label = (property: string) =>
    (
      reservationProductProperty(product.family, property)?.label ?? property
    ).toLowerCase();
  // The first "any of" names the product, as in "Reserved Desk cowork".
  const leading = product.properties.find(
    (
      condition
    ): condition is Extract<
      ReservationProductPropertyCondition,
      { readonly operator: "anyOf" | "noneOf" }
    > => condition.operator === "anyOf"
  );
  const clauses = product.properties
    .filter((condition) => condition !== leading)
    .map((condition) =>
      Match.value(condition).pipe(
        Match.when(
          { operator: "anyOf" },
          ({ property, value }) =>
            `${label(property)} ${names(property, value)}`
        ),
        Match.when(
          { operator: "noneOf" },
          ({ property, value }) =>
            `${label(property)} other than ${names(property, value)}`
        ),
        Match.when({ operator: "is" }, ({ property, value }) =>
          value ? label(property) : `no ${label(property)}`
        ),
        Match.when(
          { operator: Match.is("eq", "ne", "lt", "lte", "gt", "gte") },
          ({ property, operator, value }) => {
            const descriptor = reservationProductProperty(
              product.family,
              property
            );
            return describeCount(
              operator,
              value,
              descriptor?.kind === "number"
                ? descriptor.unit
                : { one: label(property), other: label(property) }
            );
          }
        ),
        Match.exhaustive
      )
    );
  return {
    before: `${leading ? `${names(leading.property, leading.value)} ` : ""}${family} `,
    after: clauses.length === 0 ? "" : ` with ${clauses.join(" and ")}`,
  };
};

const withArticle = (phrase: string) =>
  `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;

/** The period after a verb, or nothing for any time. */
const periodSuffix = (verb: string, period: DatePeriod) =>
  period._tag === "AnyTime" ? "" : ` ${verb}${describeDatePeriod(period)}`;

/** Chosen values joined for a sentence; nothing chosen yet reads as a gap. */
const joined = (values: readonly string[], joiner: string) =>
  values.length === 0 ? "…" : values.join(joiner);

/**
 * "have no booked Reserved Desk cowork reservations visiting in the last 30
 * days": the verb, the count, and the noun with each chosen parameter's and
 * the product's words around it, then the period.
 */
export const describeCountCondition = (
  entry: AudienceCountAttributeDefinition,
  { params, operator, value }: AudienceCountCondition
): string => {
  const chosen = Object.entries(entry.params).flatMap(
    ([key, param]): readonly AudienceChoiceOption[] => {
      if (param.part !== "choice") return [];
      const option =
        Object.entries(param.options).find(
          ([value]) => value === params[key]
        )?.[1] ?? param.absent;
      return option ? [option] : [];
    }
  );
  const product = productPhrases(params.product);
  const before = `${chosen.map(({ nounBefore = "" }) => nounBefore).join("")}${product.before}`;
  const after = `${chosen.map(({ nounAfter = "" }) => nounAfter).join("")}${product.after}`;
  const periodVerb = chosen.map(({ periodVerb = "" }) => periodVerb).join("");
  return `${entry.summary.verb} ${describeCount(operator, value, {
    one: `${before}${entry.summary.noun.one}${after}`,
    other: `${before}${entry.summary.noun.other}${after}`,
  })}${periodSuffix(periodVerb, params.period)}`;
};

/**
 * "last visited in the last 30 days", "have visited, with the last visit not
 * …", "have never visited": the entry's wording, with a reservation product
 * after its verb.
 */
const describeDateCondition = (
  { summary }: AudienceDateAttributeDefinition,
  condition: AudienceDateCondition
): string => {
  const product = condition.params && productPhrases(condition.params.product);
  const reservation = product
    ? ` for ${withArticle(`${product.before}reservation${product.after}`)}`
    : "";
  return Match.value(condition).pipe(
    Match.when({ operator: "in" }, ({ value }) =>
      value._tag === "AnyTime"
        ? `${summary.withValue}${reservation}`
        : `${summary.inPeriod}${reservation} ${describeDatePeriod(value)}`
    ),
    Match.when(
      { operator: "notIn" },
      ({ value }) =>
        `${summary.withValue}${reservation}${summary.notInPeriod} ${describeDatePeriod(value)}`
    ),
    Match.when(
      { operator: "none" },
      () => `${summary.withoutValue}${reservation}`
    ),
    Match.exhaustive
  );
};

/**
 * "speak Czech or English", "are tagged “vip” and “coworker”", "aren’t in
 * discount group “Staff”": the operator's wording and the values by name.
 */
const describeSetCondition = (
  { values, summary }: AudienceSetAttributeDefinition,
  { operator, value }: AudienceSetCondition,
  lookups: AudienceValueLookups
): string => {
  const names = value.map((chosen) =>
    Match.value(values).pipe(
      Match.tagsExhaustive({
        Options: ({ options }) => options[chosen]?.name ?? chosen,
        FreeText: () => `“${chosen}”`,
        Lookup: ({ lookup }) => {
          const option = lookups[lookup]?.find(({ id }) => id === chosen);
          return option ? `“${option.name}”` : chosen;
        },
      })
    )
  );
  return `${summary[operator] ?? operator} ${joined(names, operator === "allOf" ? " and " : " or ")}`;
};

const describeBooleanCondition = (
  { summary }: AudienceBooleanAttributeDefinition,
  { value }: AudienceBooleanCondition
): string => (value ? summary.true : summary.false);

/** What a customer must satisfy, as a plural predicate ("speak Czech and …"). */
const describeCondition = (
  condition: Parameters<typeof viewAudienceCondition>[0],
  lookups: AudienceValueLookups
): string =>
  Match.value(viewAudienceCondition(condition)).pipe(
    Match.discriminatorsExhaustive("kind")({
      count: ({ entry, condition: count }) =>
        describeCountCondition(entry, count),
      date: ({ entry, condition: date }) => describeDateCondition(entry, date),
      set: ({ entry, condition: set }) =>
        describeSetCondition(entry, set, lookups),
      boolean: ({ entry, condition: boolean }) =>
        describeBooleanCondition(entry, boolean),
    })
  );

const describeFilter = (
  filter: AudienceFilter,
  lookups: AudienceValueLookups
): string => {
  if (filter._tag !== "Group") return describeCondition(filter, lookups);
  if (filter.filters.length === 0) {
    return filter.operator === "and" ? "match anything" : "match nothing";
  }
  return filter.filters
    .map((child) =>
      child._tag === "Group" && child.filters.length > 1
        ? `(${describeFilter(child, lookups)})`
        : describeFilter(child, lookups)
    )
    .join(filter.operator === "and" ? " and " : " or ");
};

const endsAtEvaluation = (period: DatePeriod) =>
  period._tag === "Last" || period._tag === "Since";

/**
 * Whether a period in the filter runs up to the evaluation time ("last N
 * days", "since"), so the audience it describes moves with the clock. A sent
 * campaign evaluated those at its send time.
 */
export const hasPeriodEndingAtEvaluation = (filter: AudienceFilter): boolean =>
  audienceConditionsOf(filter).some((condition) =>
    Match.value(viewAudienceCondition(condition)).pipe(
      Match.discriminatorsExhaustive("kind")({
        count: ({ condition: count }) => endsAtEvaluation(count.params.period),
        date: ({ condition: date }) =>
          date.operator !== "none" && endsAtEvaluation(date.value),
        set: () => false,
        boolean: () => false,
      })
    )
  );

/**
 * One sentence of plain English for an audience filter tree. Looked-up
 * values, such as discount groups, show by name when `lookups` lists them,
 * otherwise by ID.
 */
export const describeAudienceFilter = (
  filter: AudienceFilter,
  lookups: AudienceValueLookups = {}
): string => {
  if (filter._tag === "Group" && filter.filters.length === 0) {
    return filter.operator === "and"
      ? "Every customer Workspace knows"
      : "Nobody";
  }
  return `Customers who ${describeFilter(filter, lookups)}`;
};
