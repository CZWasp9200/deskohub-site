import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import { Match, Option, Schema } from "effect";
import type { AdministrationReservationStatusFilter } from "@/features/administration/administration.service";
import { type Locale, locales } from "@/features/i18n";
import { isPlainDateString } from "@/shared/utils/temporal";

const reservationStatusFilters = [
  "in_progress",
  "complete",
  "cancelled",
  "needs_refund",
] as const satisfies readonly AdministrationReservationStatusFilter[];

const calendarDateSchema = Schema.String.check(isPlainDateString());

/**
 * Whether the customer has (or hasn't) a Workspace reservation, optionally
 * within an inclusive calendar date range and in one admin status group.
 * `visit` dates the reservation by when the customer occupies the space (its
 * Dotypos start), `booking` by when the customer booked it in Workspace.
 */
export const audienceReservationConditionSchema = Schema.TaggedStruct(
  "Reservation",
  {
    presence: Schema.Literals(["has", "hasNot"]),
    dateBasis: Schema.Literals(["visit", "booking"]),
    from: Schema.optionalKey(calendarDateSchema),
    to: Schema.optionalKey(calendarDateSchema),
    status: Schema.optionalKey(Schema.Literals(reservationStatusFilters)),
  }
);
export type AudienceReservationCondition =
  typeof audienceReservationConditionSchema.Type;

/** The customer's resolved campaign locale is one of these. */
export const audienceLocaleConditionSchema = Schema.TaggedStruct("Locale", {
  locales: Schema.NonEmptyArray(Schema.Literals(locales)),
});

/** Whether the customer has a linked Workspace account. */
export const audienceAccountConditionSchema = Schema.TaggedStruct("Account", {
  hasAccount: Schema.Boolean,
});

/** The customer's Dotypos profile carries this tag. */
export const audienceDotyposTagConditionSchema = Schema.TaggedStruct(
  "DotyposTag",
  { tag: Schema.NonEmptyString }
);

/** The customer's Dotypos profile belongs to this discount group. */
export const audienceDiscountGroupConditionSchema = Schema.TaggedStruct(
  "DiscountGroup",
  { discountGroupId: Schema.NonEmptyString }
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

export type AudienceFilter =
  | AudienceReservationCondition
  | typeof audienceLocaleConditionSchema.Type
  | typeof audienceAccountConditionSchema.Type
  | typeof audienceDotyposTagConditionSchema.Type
  | typeof audienceDiscountGroupConditionSchema.Type
  | AudienceFilterGroup;

export const audienceFilterGroupSchema = Schema.TaggedStruct("Group", {
  operator: Schema.Literals(["and", "or"]),
  filters: Schema.Array(
    Schema.suspend((): Schema.Codec<AudienceFilter> => audienceFilterSchema)
  ),
});

/** The filter tree a campaign audience selects its recipients with. */
export const audienceFilterSchema: Schema.Codec<AudienceFilter> = Schema.Union([
  audienceReservationConditionSchema,
  audienceLocaleConditionSchema,
  audienceAccountConditionSchema,
  audienceDotyposTagConditionSchema,
  audienceDiscountGroupConditionSchema,
  audienceFilterGroupSchema,
]).annotate({
  identifier: "AudienceFilter",
  description:
    "Nested AND/OR tree of reservation, locale, account, Dotypos tag, and discount-group conditions.",
});

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
