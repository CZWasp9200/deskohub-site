import { Schema } from "effect";
import {
  AdministrationCampaignLocale,
  AdministrationCampaignPurpose,
} from "./campaign-locale-and-purpose";
import { DatePeriod } from "./date-period";
import {
  AdministrationReservationFamily,
  AdministrationReservationStatusFilter,
} from "./workspace-admin-api";

/** How a count attribute compares with the condition's number. */
export const AudienceCountOperator = Schema.Literals([
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
]);
export type AudienceCountOperator = typeof AudienceCountOperator.Type;

/**
 * A date attribute's value lies in the period (`in`), exists outside it
 * (`notIn`), or doesn't exist (`none`).
 */
export const AudienceDateOperator = Schema.Literals(["in", "notIn", "none"]);
export type AudienceDateOperator = typeof AudienceDateOperator.Type;

/** A set attribute includes any, all, or none of the chosen values. */
export const AudienceSetOperator = Schema.Literals([
  "anyOf",
  "allOf",
  "noneOf",
]);
export type AudienceSetOperator = typeof AudienceSetOperator.Type;

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const chosen = <Value extends Schema.Top>(value: Value) =>
  // An empty choice is typeable, so the Admin UI can hold one while the
  // operator picks values, but it never decodes.
  Schema.Array(value).check(Schema.isMinLength(1));

/**
 * One condition on a catalog property of a reservation product: an enum
 * property is any or none of its values, a boolean property is true or
 * false, and a number property compares like a count. Workspace checks the
 * property and its values against its reservation product catalog.
 */
export const ReservationProductPropertyCondition = Schema.Union([
  Schema.Struct({
    property: Schema.NonEmptyString,
    operator: Schema.Literals(["anyOf", "noneOf"]),
    value: chosen(Schema.NonEmptyString),
  }),
  Schema.Struct({
    property: Schema.NonEmptyString,
    operator: Schema.Literal("is"),
    value: Schema.Boolean,
  }),
  Schema.Struct({
    property: Schema.NonEmptyString,
    operator: AudienceCountOperator,
    value: count,
  }),
]);
export type ReservationProductPropertyCondition =
  typeof ReservationProductPropertyCondition.Type;

/**
 * Limits reservation-based attributes to one product family, and optionally
 * to reservations whose catalog properties all meet their conditions.
 */
export const ReservationProductFilter = Schema.Struct({
  family: AdministrationReservationFamily,
  properties: Schema.Array(ReservationProductPropertyCondition),
}).annotate({
  identifier: "ReservationProductFilter",
  description:
    "A reservation product family and conditions on its catalog properties.",
});
export type ReservationProductFilter = typeof ReservationProductFilter.Type;

/**
 * One condition shape of one attribute. Each attribute lists its shapes as
 * separate union members. `attribute` comes before `_tag` because a union
 * dispatches on the first literal key it indexes: with `attribute` first, a
 * condition is checked only against its own attribute's shapes, so validation
 * errors point at its fields rather than at every attribute's.
 */
const conditionShape = <
  const Attribute extends string,
  const Fields extends Schema.Struct.Fields,
>(
  attribute: Attribute,
  fields: Fields
) =>
  Schema.Struct({
    attribute: Schema.Literal(attribute),
    _tag: Schema.tag("Condition"),
    ...fields,
  });

const countCondition = <
  const Attribute extends string,
  Params extends Schema.Top,
>(
  attribute: Attribute,
  params: Params
) =>
  [
    conditionShape(attribute, {
      params,
      operator: AudienceCountOperator,
      value: count,
    }),
  ] as const;

const dateCondition = <
  const Attribute extends string,
  const Fields extends Schema.Struct.Fields,
>(
  attribute: Attribute,
  fields: Fields
) =>
  [
    conditionShape(attribute, {
      ...fields,
      operator: Schema.Literals(["in", "notIn"]),
      value: DatePeriod,
    }),
    conditionShape(attribute, {
      ...fields,
      operator: Schema.Literal("none"),
    }),
  ] as const;

const setCondition = <
  const Attribute extends string,
  Value extends Schema.Top,
  const Operators extends readonly [
    AudienceSetOperator,
    ...AudienceSetOperator[],
  ],
>(
  attribute: Attribute,
  operators: Operators,
  value: Value
) =>
  [
    conditionShape(attribute, {
      operator: Schema.Literals(operators),
      value: chosen(value),
    }),
  ] as const;

const booleanCondition = <const Attribute extends string>(
  attribute: Attribute
) =>
  [
    conditionShape(attribute, {
      operator: Schema.Literal("is"),
      value: Schema.Boolean,
    }),
  ] as const;

/**
 * The customer attributes an audience can filter on, by kind. Each entry's
 * schema is the condition's whole wire shape: `attribute`, its `params`, and
 * an `operator` and `value` of its kind. Workspace keys its resolvers,
 * evaluation, summaries, and Admin UI controls by these attributes.
 */
export const audienceAttributeCatalogue = {
  /**
   * Booked reservations dated by visit (the Dotypos start) or booking
   * (`reservation_confirmed_at`) within the period. Without a status only
   * booked reservations count: confirmed and never cancelled.
   */
  reservationCount: {
    kind: "count",
    conditions: countCondition(
      "reservationCount",
      Schema.Struct({
        dateBasis: Schema.Literals(["visit", "booking"]),
        period: DatePeriod,
        status: Schema.optionalKey(AdministrationReservationStatusFilter),
        product: Schema.optionalKey(ReservationProductFilter),
      })
    ),
  },
  /**
   * Campaign emails Resend accepted for the customer (sent, delivered,
   * complained, or unconfirmed), dated by dispatch. Transactional emails
   * have no per-customer record and never count.
   */
  campaignEmailCount: {
    kind: "count",
    conditions: countCondition(
      "campaignEmailCount",
      Schema.Struct({
        purpose: Schema.Union([
          AdministrationCampaignPurpose,
          Schema.Literal("any"),
        ]),
        period: DatePeriod,
      })
    ),
  },
  /**
   * Start of the customer's latest booked reservation that has begun, of the
   * product when `params.product` names one.
   */
  lastVisit: {
    kind: "date",
    conditions: dateCondition("lastVisit", {
      params: Schema.optionalKey(
        Schema.Struct({ product: ReservationProductFilter })
      ),
    }),
  },
  /** When the customer's linked Workspace account was created. */
  accountCreated: {
    kind: "date",
    conditions: dateCondition("accountCreated", {}),
  },
  /** The customer's resolved campaign locale. */
  locale: {
    kind: "set",
    conditions: setCondition(
      "locale",
      ["anyOf", "noneOf"],
      AdministrationCampaignLocale
    ),
  },
  /** Tags on the customer's Dotypos profile. */
  dotyposTags: {
    kind: "set",
    conditions: setCondition(
      "dotyposTags",
      ["anyOf", "allOf", "noneOf"],
      Schema.NonEmptyString
    ),
  },
  /** The discount group (ID) of the customer's Dotypos profile. */
  discountGroup: {
    kind: "set",
    conditions: setCondition(
      "discountGroup",
      ["anyOf", "noneOf"],
      Schema.NonEmptyString
    ),
  },
  /** Whether the customer has a linked Workspace account. */
  hasAccount: { kind: "boolean", conditions: booleanCondition("hasAccount") },
} as const;

type AudienceAttributeCatalogue = typeof audienceAttributeCatalogue;

export type AudienceAttribute = keyof AudienceAttributeCatalogue;
export type AudienceAttributeKind =
  AudienceAttributeCatalogue[AudienceAttribute]["kind"];

/** Every attribute of one kind. */
export type AudienceAttributeOfKind<Kind extends AudienceAttributeKind> = {
  readonly [Attribute in AudienceAttribute]: AudienceAttributeCatalogue[Attribute]["kind"] extends Kind
    ? Attribute
    : never;
}[AudienceAttribute];

export type AudienceCondition = {
  readonly [Attribute in AudienceAttribute]: AudienceAttributeCatalogue[Attribute]["conditions"][number]["Type"];
}[AudienceAttribute];

/** The condition shape of one attribute. */
export type AudienceConditionOf<Attribute extends AudienceAttribute> = Extract<
  AudienceCondition,
  { readonly attribute: Attribute }
>;

const audienceConditionMembers: readonly Schema.Codec<AudienceCondition>[] =
  Object.values(audienceAttributeCatalogue).flatMap(
    ({ conditions }): readonly Schema.Codec<AudienceCondition>[] => conditions
  );

/** One condition on one catalogued customer attribute. */
export const AudienceCondition: Schema.Codec<AudienceCondition> = Schema.Union(
  audienceConditionMembers
);

/**
 * A nested AND/OR group. An empty AND group matches every candidate, so an
 * audience whose root is `{ operator: "and", filters: [] }` reaches all
 * customers Workspace knows; an empty OR group matches nobody.
 */
export type AudienceFilterGroup = {
  readonly _tag: "Group";
  readonly operator: "and" | "or";
  readonly filters: readonly AudienceFilter[];
};

export type AudienceFilter = AudienceCondition | AudienceFilterGroup;

const audienceFilterGroup = Schema.TaggedStruct("Group", {
  operator: Schema.Literals(["and", "or"]),
  filters: Schema.Array(
    Schema.suspend((): Schema.Codec<AudienceFilter> => AudienceFilter)
  ),
});

/**
 * The filter tree a campaign audience selects its recipients with. Workspace
 * stores and evaluates this schema, and the administration API carries it, so
 * it has one definition. It ignores excess properties when decoded on its own;
 * the strict API inputs that embed it reject them.
 */
export const AudienceFilter: Schema.Codec<AudienceFilter> = Schema.Union<
  readonly Schema.Codec<AudienceFilter>[]
>([...audienceConditionMembers, audienceFilterGroup]).annotate({
  identifier: "AudienceFilter",
  description:
    "Nested AND/OR tree of attribute conditions: reservation and campaign-email counts, last visit and account creation dates, locale, Dotypos tags, discount group, and account presence.",
});
