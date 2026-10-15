import type {
  AudienceCountOperatorType,
  ReservationProductFilterType,
  ReservationProductPropertyCondition,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import type { Locale } from "@/features/i18n";
import {
  reservationProductFamilies,
  reservationProductProperty,
} from "@/features/reservation/reservation-product-descriptor";
import type { AudienceCondition, AudienceFilter } from "../audience-filter";
import type { DatePeriod } from "../date-period";
import { describeDatePeriod } from "./date-period-phrases";

/** A Dotypos discount group an audience can filter by. */
export type DiscountGroupOption = {
  readonly id: string;
  readonly name: string;
};

const localeNames: Readonly<Record<Locale, string>> = {
  "cs-CZ": "Czech",
  "en-US": "English",
};

/** How a status reads around "reservation": before it, or after it. */
const reservationStatusPhrases = {
  in_progress: { before: "", after: " in progress" },
  complete: { before: "complete ", after: "" },
  cancelled: { before: "cancelled ", after: "" },
  needs_refund: { before: "", after: " needing a refund" },
} as const;

type Noun = { readonly one: string; readonly other: string };

/**
 * The count as it reads in a sentence: "any emails" for more than zero, "no
 * emails" for zero, otherwise "at least 3 emails", "fewer than 2 emails", ….
 */
export const describeCount = (
  operator: AudienceCountOperatorType,
  value: number,
  noun: Noun
): string => {
  // A half-typed number reads as a gap until the operator finishes it.
  if (!Number.isInteger(value)) return `… ${noun.other}`;
  const counted = `${value} ${value === 1 ? noun.one : noun.other}`;
  const any = `any ${noun.other}`;
  const none = `no ${noun.other}`;
  return Match.value(operator).pipe(
    Match.when("eq", () => (value === 0 ? none : `exactly ${counted}`)),
    Match.when("ne", () => (value === 0 ? any : `other than ${counted}`)),
    Match.when("lt", () => (value <= 1 ? none : `fewer than ${counted}`)),
    Match.when("lte", () => (value === 0 ? none : `at most ${counted}`)),
    Match.when("gt", () => (value === 0 ? any : `more than ${counted}`)),
    Match.when("gte", () => {
      // "≥ 0" holds for everyone, records or not.
      if (value === 0) return `any number of ${noun.other}`;
      return value === 1 ? any : `at least ${counted}`;
    }),
    Match.exhaustive
  );
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

const quoted = (values: readonly string[], joiner: string) =>
  joined(
    values.map((value) => `“${value}”`),
    joiner
  );

/** What a customer must satisfy, as a plural predicate ("speak Czech and …"). */
const describeCondition = (
  condition: AudienceCondition,
  discountGroups: readonly DiscountGroupOption[]
): string =>
  Match.value(condition).pipe(
    Match.discriminatorsExhaustive("attribute")({
      reservationCount: ({ params, operator, value }) => {
        // Without a status only booked (confirmed, never cancelled)
        // reservations count.
        const status = params.status
          ? reservationStatusPhrases[params.status]
          : { before: "booked ", after: "" };
        const product = productPhrases(params.product);
        return `have ${describeCount(operator, value, {
          one: `${status.before}${product.before}reservation${status.after}${product.after}`,
          other: `${status.before}${product.before}reservations${status.after}${product.after}`,
        })}${periodSuffix(
          params.dateBasis === "visit" ? "visiting " : "confirmed ",
          params.period
        )}`;
      },
      campaignEmailCount: ({ params, operator, value }) => {
        const purpose = params.purpose === "any" ? "" : `${params.purpose} `;
        return `received ${describeCount(operator, value, {
          one: `${purpose}campaign email`,
          other: `${purpose}campaign emails`,
        })}${periodSuffix("", params.period)}`;
      },
      lastVisit: (date) => {
        const product = productPhrases(date.params?.product);
        const visited = date.params
          ? ` for ${withArticle(`${product.before}reservation${product.after}`)}`
          : "";
        return Match.value(date).pipe(
          Match.when({ operator: "in" }, ({ value }) =>
            value._tag === "AnyTime"
              ? `have visited${visited}`
              : `last visited${visited} ${describeDatePeriod(value)}`
          ),
          Match.when(
            { operator: "notIn" },
            ({ value }) =>
              `have visited${visited}, with the last visit not ${describeDatePeriod(value)}`
          ),
          Match.when(
            { operator: "none" },
            () => `have never visited${visited}`
          ),
          Match.exhaustive
        );
      },
      accountCreated: (date) =>
        Match.value(date).pipe(
          Match.when({ operator: "in" }, ({ value }) =>
            value._tag === "AnyTime"
              ? "have a Workspace account"
              : `created a Workspace account ${describeDatePeriod(value)}`
          ),
          Match.when(
            { operator: "notIn" },
            ({ value }) =>
              `have a Workspace account not created ${describeDatePeriod(value)}`
          ),
          Match.when({ operator: "none" }, () => "have no Workspace account"),
          Match.exhaustive
        ),
      locale: ({ operator, value }) => {
        const names = joined(
          value.map((locale) => localeNames[locale]),
          " or "
        );
        return operator === "anyOf" ? `speak ${names}` : `don’t speak ${names}`;
      },
      dotyposTags: ({ operator, value }) =>
        Match.value(operator).pipe(
          Match.when("anyOf", () => `are tagged ${quoted(value, " or ")}`),
          Match.when("allOf", () => `are tagged ${quoted(value, " and ")}`),
          Match.when("noneOf", () => `aren’t tagged ${quoted(value, " or ")}`),
          Match.exhaustive
        ),
      discountGroup: ({ operator, value }) => {
        const names = joined(
          value.map((id) => {
            const group = discountGroups.find((option) => option.id === id);
            return group ? `“${group.name}”` : id;
          }),
          " or "
        );
        return operator === "anyOf"
          ? `are in discount group ${names}`
          : `aren’t in discount group ${names}`;
      },
      hasAccount: ({ value }) =>
        value ? "have a Workspace account" : "have no Workspace account",
    })
  );

const describeFilter = (
  filter: AudienceFilter,
  discountGroups: readonly DiscountGroupOption[]
): string => {
  if (filter._tag !== "Group") return describeCondition(filter, discountGroups);
  if (filter.filters.length === 0) {
    return filter.operator === "and" ? "match anything" : "match nothing";
  }
  return filter.filters
    .map((child) =>
      child._tag === "Group" && child.filters.length > 1
        ? `(${describeFilter(child, discountGroups)})`
        : describeFilter(child, discountGroups)
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
  filter._tag === "Group"
    ? filter.filters.some(hasPeriodEndingAtEvaluation)
    : Match.value(filter).pipe(
        Match.discriminatorsExhaustive("attribute")({
          reservationCount: ({ params }) => endsAtEvaluation(params.period),
          campaignEmailCount: ({ params }) => endsAtEvaluation(params.period),
          lastVisit: (date) => "value" in date && endsAtEvaluation(date.value),
          accountCreated: (date) =>
            "value" in date && endsAtEvaluation(date.value),
          locale: () => false,
          dotyposTags: () => false,
          discountGroup: () => false,
          hasAccount: () => false,
        })
      );

/**
 * One sentence of plain English for an audience filter tree. Discount groups
 * show by name when `discountGroups` lists them, otherwise by ID.
 */
export const describeAudienceFilter = (
  filter: AudienceFilter,
  discountGroups: readonly DiscountGroupOption[] = []
): string => {
  if (filter._tag === "Group" && filter.filters.length === 0) {
    return filter.operator === "and"
      ? "Every customer Workspace knows"
      : "Nobody";
  }
  return `Customers who ${describeFilter(filter, discountGroups)}`;
};
