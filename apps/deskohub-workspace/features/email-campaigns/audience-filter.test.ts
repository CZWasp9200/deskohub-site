import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import {
  type AudienceCandidate,
  type AudienceFilter,
  type AudienceReservationMatches,
  audienceFilterSchema,
  audienceSingleLocale,
  collectReservationCriteria,
  evaluateAudienceFilter,
  reservationConditionKey,
} from "./audience-filter";

const customerId = DotyposCustomerIdSchema.make("customer-1");

const candidate: AudienceCandidate = {
  dotyposCustomerId: customerId,
  locale: "en-US",
  hasAccount: true,
};

const profile = (fields: Partial<DotyposCustomer>) =>
  Option.some({ deleted: false, ...fields } as DotyposCustomer);

const visitedInMarch = {
  _tag: "Reservation",
  presence: "has",
  dateBasis: "visit",
  from: "2026-03-01",
  to: "2026-03-31",
} as const;

const bookedInMarch = { ...visitedInMarch, dateBasis: "booking" } as const;

const matchesFor = (
  entries: readonly (readonly [
    typeof visitedInMarch | typeof bookedInMarch,
    readonly DotyposCustomerId[],
  ])[]
): AudienceReservationMatches =>
  new Map(
    entries.map(([{ _tag, presence, ...criteria }, customers]) => [
      reservationConditionKey(criteria),
      new Set(customers),
    ])
  );

const evaluate = (
  filter: AudienceFilter,
  options: {
    readonly reservationMatches?: AudienceReservationMatches;
    readonly profile?: Option.Option<DotyposCustomer>;
  } = {}
) =>
  evaluateAudienceFilter({
    filter,
    candidate,
    reservationMatches: options.reservationMatches ?? new Map(),
    profile: options.profile ?? Option.none(),
  });

const group = (
  operator: "and" | "or",
  filters: readonly AudienceFilter[]
): AudienceFilter => ({ _tag: "Group", operator, filters });

const tagged = { _tag: "DotyposTag", tag: "vip" } as const;
const czech = { _tag: "Locale", locales: ["cs-CZ"] } as const;
const withAccount = { _tag: "Account", hasAccount: true } as const;

describe("evaluateAudienceFilter", () => {
  test("leaves Dotypos conditions unknown until the profile is loaded", () => {
    expect(evaluate(tagged)).toBe("unknown");
    expect(evaluate(tagged, { profile: profile({ tags: ["vip"] }) })).toBe(
      "match"
    );
    expect(evaluate(tagged, { profile: profile({ tags: null }) })).toBe(
      "noMatch"
    );
  });

  test("lets a local condition decide a group before hydration", () => {
    expect(evaluate(group("and", [czech, tagged]))).toBe("noMatch");
    expect(evaluate(group("or", [withAccount, tagged]))).toBe("match");
    expect(evaluate(group("and", [withAccount, tagged]))).toBe("unknown");
    expect(evaluate(group("or", [czech, tagged]))).toBe("unknown");
  });

  test("evaluates nested AND/OR groups", () => {
    const filter = group("or", [
      group("and", [czech, withAccount]),
      group("and", [
        withAccount,
        { _tag: "DiscountGroup", discountGroupId: "gold" },
      ]),
    ]);
    expect(
      evaluate(filter, { profile: profile({ _discountGroupId: null }) })
    ).toBe("noMatch");
    expect(
      evaluate(filter, {
        profile: profile({
          _discountGroupId: "gold" as DotyposCustomer["_discountGroupId"],
        }),
      })
    ).toBe("match");
  });

  test("treats an empty AND group as everyone and an empty OR group as nobody", () => {
    expect(evaluate(group("and", []))).toBe("match");
    expect(evaluate(group("or", []))).toBe("noMatch");
  });

  test("keeps visit-date and booking-date reservation matches apart", () => {
    const reservationMatches = matchesFor([
      [visitedInMarch, [customerId]],
      [bookedInMarch, []],
    ]);
    expect(evaluate(visitedInMarch, { reservationMatches })).toBe("match");
    expect(evaluate(bookedInMarch, { reservationMatches })).toBe("noMatch");
    expect(
      evaluate({ ...bookedInMarch, presence: "hasNot" }, { reservationMatches })
    ).toBe("match");
  });
});

describe("collectReservationCriteria", () => {
  test("requests each distinct reservation lookup once", () => {
    const criteria = collectReservationCriteria(
      group("or", [
        visitedInMarch,
        { ...visitedInMarch, presence: "hasNot" },
        group("and", [bookedInMarch, tagged]),
      ])
    );
    expect(criteria.map((entry) => entry.dateBasis).sort()).toEqual([
      "booking",
      "visit",
    ]);
  });
});

describe("audienceFilterSchema", () => {
  test("round-trips a nested filter tree", () => {
    const filter = group("and", [visitedInMarch, group("or", [czech, tagged])]);
    expect(Schema.decodeUnknownSync(audienceFilterSchema)(filter)).toEqual(
      filter
    );
  });

  test("rejects malformed calendar dates and empty locale lists", () => {
    const decode = Schema.decodeUnknownOption(audienceFilterSchema);
    expect(Option.isNone(decode({ ...visitedInMarch, from: "2026-3-1" }))).toBe(
      true
    );
    expect(Option.isNone(decode({ _tag: "Locale", locales: [] }))).toBe(true);
  });
});

describe("audienceSingleLocale", () => {
  const english = { _tag: "Locale", locales: ["en-US"] } as const;

  test("finds a one-locale condition at the root", () => {
    expect(audienceSingleLocale(english)).toBe("en-US");
  });

  test("finds a one-locale condition in the root AND group", () => {
    expect(audienceSingleLocale(group("and", [withAccount, czech]))).toBe(
      "cs-CZ"
    );
  });

  test("ignores conditions that allow several locales", () => {
    expect(
      audienceSingleLocale({ _tag: "Locale", locales: ["cs-CZ", "en-US"] })
    ).toBeUndefined();
  });

  test("ignores a root OR group and nested groups", () => {
    expect(audienceSingleLocale(group("or", [czech]))).toBeUndefined();
    expect(
      audienceSingleLocale(group("and", [group("and", [czech])]))
    ).toBeUndefined();
  });
});
