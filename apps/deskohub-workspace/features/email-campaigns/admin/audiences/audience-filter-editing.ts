import type {
  AudienceAttribute,
  AudienceConditionOf,
  DatePeriodUnitType,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import type {
  AudienceCondition,
  AudienceFilter,
  AudienceFilterGroup,
} from "../../audience-filter";
import type { DatePeriod } from "../../date-period";

export type { AudienceCondition, AudienceFilterGroup };

export type ReservationStatus = NonNullable<
  AudienceConditionOf<"reservationCount">["params"]["status"]
>;

/** The builder always edits a group, so a bare stored condition gets an AND root. */
export const asRootGroup = (filter: AudienceFilter): AudienceFilterGroup =>
  filter._tag === "Group"
    ? filter
    : { _tag: "Group", operator: "and", filters: [filter] };

const lastThirtyDays: DatePeriod = { _tag: "Last", count: 30, unit: "day" };

const newConditions = {
  reservationCount: () => ({
    _tag: "Condition",
    attribute: "reservationCount",
    params: { dateBasis: "visit", period: { _tag: "AnyTime" } },
    operator: "gt",
    value: 0,
  }),
  campaignEmailCount: () => ({
    _tag: "Condition",
    attribute: "campaignEmailCount",
    params: { purpose: "marketing", period: lastThirtyDays },
    operator: "eq",
    value: 0,
  }),
  lastVisit: () => ({
    _tag: "Condition",
    attribute: "lastVisit",
    operator: "in",
    value: lastThirtyDays,
  }),
  accountCreated: () => ({
    _tag: "Condition",
    attribute: "accountCreated",
    operator: "in",
    value: lastThirtyDays,
  }),
  locale: () => ({
    _tag: "Condition",
    attribute: "locale",
    operator: "anyOf",
    value: ["cs-CZ"],
  }),
  dotyposTags: () => ({
    _tag: "Condition",
    attribute: "dotyposTags",
    operator: "anyOf",
    value: [],
  }),
  discountGroup: () => ({
    _tag: "Condition",
    attribute: "discountGroup",
    operator: "anyOf",
    value: [],
  }),
  hasAccount: () => ({
    _tag: "Condition",
    attribute: "hasAccount",
    operator: "is",
    value: true,
  }),
} satisfies {
  readonly [Attribute in AudienceAttribute]: () => AudienceConditionOf<Attribute>;
};

/** Starting values for a condition an operator adds or switches to. */
export const newCondition = (attribute: AudienceAttribute): AudienceCondition =>
  newConditions[attribute]();

/** An empty group nested in `parent`, which usually flips the parent's logic. */
export const newNestedGroup = (
  parent: AudienceFilterGroup
): AudienceFilterGroup => ({
  _tag: "Group",
  operator: parent.operator === "and" ? "or" : "and",
  filters: [],
});

export const appendFilter = (
  group: AudienceFilterGroup,
  filter: AudienceFilter
): AudienceFilterGroup => ({ ...group, filters: [...group.filters, filter] });

export const replaceFilterAt = (
  group: AudienceFilterGroup,
  index: number,
  filter: AudienceFilter
): AudienceFilterGroup => ({
  ...group,
  filters: group.filters.map((current, i) => (i === index ? filter : current)),
});

export const removeFilterAt = (
  group: AudienceFilterGroup,
  index: number
): AudienceFilterGroup => ({
  ...group,
  filters: group.filters.filter((_, i) => i !== index),
});

/** Adds or removes one chosen value, keeping the original order. */
export const toggleSetValue = <Value>(
  selected: readonly Value[],
  value: Value,
  checked: boolean
): readonly Value[] => {
  const others = selected.filter((current) => current !== value);
  return checked ? [...others, value] : others;
};

export type DatePeriodKind = DatePeriod["_tag"];

/**
 * The period after the operator switches its kind, keeping the dates and
 * count it already had where the new kind uses them.
 */
export const switchDatePeriod = (
  period: DatePeriod,
  kind: DatePeriodKind,
  today: string
): DatePeriod => {
  const dates = Match.value(period).pipe(
    Match.tagsExhaustive({
      AnyTime: () => ({ from: today, to: today }),
      Last: () => ({ from: today, to: today }),
      Range: ({ from, to }) => ({ from, to }),
      Since: ({ date }) => ({ from: date, to: date }),
      Onward: ({ date }) => ({ from: date, to: date }),
      Until: ({ date }) => ({ from: date, to: date }),
    })
  );
  return Match.value(kind).pipe(
    Match.when("AnyTime", (): DatePeriod => ({ _tag: "AnyTime" })),
    Match.when(
      "Last",
      (): DatePeriod => (period._tag === "Last" ? period : lastThirtyDays)
    ),
    Match.when(
      "Range",
      (): DatePeriod => ({ _tag: "Range", from: dates.from, to: dates.to })
    ),
    Match.when(
      "Since",
      (): DatePeriod => ({ _tag: "Since", date: dates.from })
    ),
    Match.when(
      "Onward",
      (): DatePeriod => ({ _tag: "Onward", date: dates.from })
    ),
    Match.when("Until", (): DatePeriod => ({ _tag: "Until", date: dates.to })),
    Match.exhaustive
  );
};

export const isDatePeriodUnit = (value: string): value is DatePeriodUnitType =>
  value === "day" || value === "week" || value === "month" || value === "year";
