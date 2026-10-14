import type { Locale } from "@/features/i18n";
import type { AudienceFilter } from "../../audience-filter";

export type AudienceFilterGroup = Extract<AudienceFilter, { _tag: "Group" }>;
export type AudienceCondition = Exclude<AudienceFilter, { _tag: "Group" }>;
export type ReservationCondition = Extract<
  AudienceFilter,
  { _tag: "Reservation" }
>;
export type ReservationStatus = NonNullable<ReservationCondition["status"]>;

/** The builder always edits a group, so a bare stored condition gets an AND root. */
export const asRootGroup = (filter: AudienceFilter): AudienceFilterGroup =>
  filter._tag === "Group"
    ? filter
    : { _tag: "Group", operator: "and", filters: [filter] };

const newConditions: {
  readonly [Tag in AudienceCondition["_tag"]]: Extract<
    AudienceCondition,
    { _tag: Tag }
  >;
} = {
  Reservation: { _tag: "Reservation", presence: "has", dateBasis: "visit" },
  Locale: { _tag: "Locale", locales: ["cs-CZ"] },
  DotyposTag: { _tag: "DotyposTag", tag: "" },
  DiscountGroup: { _tag: "DiscountGroup", discountGroupId: "" },
  Account: { _tag: "Account", hasAccount: true },
};

/** Starting values for a condition an operator adds. */
export const newCondition = (
  tag: AudienceCondition["_tag"]
): AudienceCondition => newConditions[tag];

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

/**
 * Locales left after checking or unchecking one, or `undefined` when the
 * change would leave none; the schema needs at least one.
 */
export const toggleLocale = (
  selected: readonly Locale[],
  locale: Locale,
  checked: boolean
): readonly [Locale, ...Locale[]] | undefined => {
  const others = selected.filter((value) => value !== locale);
  const [first, ...rest] = checked ? [...others, locale] : others;
  return first ? [first, ...rest] : undefined;
};

/** Updates optional reservation criteria, omitting empty ones rather than storing them. */
export const setReservationCriteria = (
  condition: ReservationCondition,
  changes: {
    readonly from?: string | undefined;
    readonly to?: string | undefined;
    readonly status?: ReservationStatus | undefined;
  }
): ReservationCondition => {
  const { from, to, status, ...required } = { ...condition, ...changes };
  let next: ReservationCondition = required;
  if (from) next = { ...next, from };
  if (to) next = { ...next, to };
  if (status) next = { ...next, status };
  return next;
};
