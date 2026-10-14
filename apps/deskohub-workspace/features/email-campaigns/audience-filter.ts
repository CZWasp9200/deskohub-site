import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import {
  type AudienceFilterType,
  AudienceFilter as audienceFilterSchema,
} from "@deskohub/workspace-admin-api";
import { Match, Option } from "effect";
import type { Locale } from "@/features/i18n";

/**
 * The filter tree a campaign audience selects its recipients with. The
 * administration contract defines it once for Workspace, the Admin UI, and
 * `dhw`.
 */
export type AudienceFilter = AudienceFilterType;
export { audienceFilterSchema };

type AudienceReservationCondition = Extract<
  AudienceFilter,
  { readonly _tag: "Reservation" }
>;
type AudienceFilterGroup = Extract<AudienceFilter, { readonly _tag: "Group" }>;

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

/** Customers with a matching reservation, keyed by {@link reservationConditionKey}. */
export type AudienceReservationMatches = ReadonlyMap<
  string,
  ReadonlySet<DotyposCustomerId>
>;

/** The reservation criteria of a condition; equal criteria share one lookup. */
export type AudienceReservationCriteria = Omit<
  AudienceReservationCondition,
  "_tag" | "presence"
>;

export const reservationConditionKey = ({
  dateBasis,
  from,
  to,
  status,
}: AudienceReservationCriteria): string =>
  [dateBasis, from ?? "", to ?? "", status ?? ""].join("|");

/** Every reservation condition in the tree, deduplicated by criteria. */
export const collectReservationCriteria = (
  filter: AudienceFilter
): readonly AudienceReservationCriteria[] => {
  const criteria = new Map<string, AudienceReservationCriteria>();
  const visit = (node: AudienceFilter): void => {
    if (node._tag === "Group") {
      node.filters.forEach(visit);
      return;
    }
    if (node._tag === "Reservation") {
      const { _tag, presence, ...reservationCriteria } = node;
      criteria.set(
        reservationConditionKey(reservationCriteria),
        reservationCriteria
      );
    }
  };
  visit(filter);
  return [...criteria.values()];
};

const fromBoolean = (value: boolean): AudienceFilterOutcome =>
  value ? "match" : "noMatch";

/**
 * Evaluates the filter for one candidate. Pass `Option.none()` as the profile
 * before Dotypos hydration; Dotypos conditions then evaluate to `unknown`.
 */
export const evaluateAudienceFilter = (input: {
  readonly filter: AudienceFilter;
  readonly candidate: AudienceCandidate;
  readonly reservationMatches: AudienceReservationMatches;
  readonly profile: Option.Option<DotyposCustomer>;
}): AudienceFilterOutcome => {
  const { candidate, reservationMatches, profile } = input;
  const profileCondition = (
    predicate: (customer: DotyposCustomer) => boolean
  ): AudienceFilterOutcome =>
    Option.match(profile, {
      onNone: () => "unknown",
      onSome: (customer) => fromBoolean(predicate(customer)),
    });

  const evaluate = (filter: AudienceFilter): AudienceFilterOutcome =>
    Match.value(filter).pipe(
      Match.tagsExhaustive({
        Reservation: ({ presence, ...criteria }) => {
          const reserved =
            reservationMatches
              .get(reservationConditionKey(criteria))
              ?.has(candidate.dotyposCustomerId) ?? false;
          return fromBoolean(presence === "has" ? reserved : !reserved);
        },
        Locale: ({ locales: selected }) =>
          fromBoolean(selected.includes(candidate.locale)),
        Account: ({ hasAccount }) =>
          fromBoolean(candidate.hasAccount === hasAccount),
        DotyposTag: ({ tag }) =>
          profileCondition((customer) => (customer.tags ?? []).includes(tag)),
        DiscountGroup: ({ discountGroupId }) =>
          profileCondition(
            (customer) => customer._discountGroupId === discountGroupId
          ),
        Group: ({ operator, filters }) =>
          combineOutcomes(operator, filters.map(evaluate)),
      })
    );

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

/**
 * The single locale every recipient of the audience has, when the filter
 * requires one: a one-locale condition at the root or directly inside the
 * root AND group. Campaign content then needs only that locale.
 */
export const audienceSingleLocale = (
  filter: AudienceFilter
): Locale | undefined => {
  if (filter._tag === "Group" && filter.operator === "or") return undefined;
  const conditions = filter._tag === "Group" ? filter.filters : [filter];
  for (const condition of conditions) {
    if (condition._tag === "Locale" && condition.locales.length === 1) {
      return condition.locales[0];
    }
  }
  return undefined;
};
