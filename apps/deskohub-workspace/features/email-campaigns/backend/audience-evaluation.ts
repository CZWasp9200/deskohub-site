import type { DotyposCustomer } from "@deskohub/dotypos";
import { Match, Option } from "effect";
import {
  type AudienceCandidate,
  type AudienceFacts,
  type AudienceFilter,
  type AudienceFilterOutcome,
  audienceFactKey,
  compareCount,
  countFactRequest,
  dateFactRequest,
  evaluateAudienceTree,
  matchesSet,
  viewAudienceCondition,
} from "../audience-filter";
import {
  type AudienceValueResolver,
  audienceAttributeResolvers,
} from "./audience-attribute-resolvers";

const outcomeOf = (value: boolean): AudienceFilterOutcome =>
  value ? "match" : "noMatch";

/**
 * Evaluates the filter for one candidate. Pass `Option.none()` as the profile
 * before Dotypos hydration; conditions read from the profile are then
 * `unknown`.
 */
export const evaluateAudienceFilter = ({
  filter,
  candidate,
  facts,
  profile,
}: {
  readonly filter: AudienceFilter;
  readonly candidate: AudienceCandidate;
  readonly facts: AudienceFacts;
  readonly profile: Option.Option<DotyposCustomer>;
}): AudienceFilterOutcome => {
  const id = candidate.dotyposCustomerId;
  const readValue = <Value>(
    resolver: AudienceValueResolver<Value>
  ): Option.Option<Value> =>
    Match.value(resolver).pipe(
      Match.discriminatorsExhaustive("from")({
        candidate: ({ read }) => Option.some(read(candidate)),
        profile: ({ read }) => Option.map(profile, read),
      })
    );
  const outcomeFrom = <Value>(
    value: Option.Option<Value>,
    predicate: (value: Value) => boolean
  ): AudienceFilterOutcome =>
    Option.match(value, {
      onNone: () => "unknown",
      onSome: (actual) => outcomeOf(predicate(actual)),
    });

  return evaluateAudienceTree(filter, (condition) =>
    Match.value(viewAudienceCondition(condition)).pipe(
      Match.discriminatorsExhaustive("kind")({
        // A candidate without records has no entry, so it counts zero.
        count: ({ condition: count }) =>
          outcomeOf(
            compareCount(
              count.operator,
              facts.counts
                .get(audienceFactKey(countFactRequest(count)))
                ?.get(id) ?? 0,
              count.value
            )
          ),
        date: ({ condition: date }) => {
          const dates = facts.dates.get(audienceFactKey(dateFactRequest(date)));
          const hasValue = dates?.withValue.has(id) ?? false;
          const inPeriod = dates?.inPeriod.has(id) ?? false;
          return outcomeOf(
            Match.value(date.operator).pipe(
              Match.when("in", () => inPeriod),
              Match.when("notIn", () => hasValue && !inPeriod),
              Match.when("none", () => !hasValue),
              Match.exhaustive
            )
          );
        },
        set: ({ condition: set }) =>
          outcomeFrom(
            readValue<readonly string[]>(
              audienceAttributeResolvers[set.attribute]
            ),
            (values) => matchesSet(set.operator, values, set.value)
          ),
        boolean: ({ condition: boolean }) =>
          outcomeFrom(
            readValue(audienceAttributeResolvers[boolean.attribute]),
            (value) => value === boolean.value
          ),
      })
    )
  );
};
