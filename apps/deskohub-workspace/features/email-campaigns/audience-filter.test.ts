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
  audienceLocales,
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

describe("audienceLocales", () => {
  const english = { _tag: "Locale", locales: ["en-US"] } as const;
  const both = { _tag: "Locale", locales: ["cs-CZ", "en-US"] } as const;
  const localesOf = (filter: AudienceFilter) =>
    [...audienceLocales(filter)].toSorted();

  test("allows every locale without a locale condition", () => {
    expect(localesOf(withAccount)).toEqual(["cs-CZ", "en-US"]);
    expect(localesOf(visitedInMarch)).toEqual(["cs-CZ", "en-US"]);
    expect(localesOf(tagged)).toEqual(["cs-CZ", "en-US"]);
    expect(
      localesOf({ _tag: "DiscountGroup", discountGroupId: "gold" })
    ).toEqual(["cs-CZ", "en-US"]);
    expect(localesOf(group("and", [tagged, withAccount]))).toEqual([
      "cs-CZ",
      "en-US",
    ]);
  });

  test("intersects AND groups at any depth", () => {
    expect(localesOf(group("and", [group("and", [english])]))).toEqual([
      "en-US",
    ]);
    expect(localesOf(group("and", [both, group("and", [czech])]))).toEqual([
      "cs-CZ",
    ]);
    expect(localesOf(group("and", [withAccount, english]))).toEqual(["en-US"]);
  });

  test("unites OR groups and lets an unconstrained filter allow every locale", () => {
    expect(localesOf(group("or", [english]))).toEqual(["en-US"]);
    expect(localesOf(group("or", [english, english]))).toEqual(["en-US"]);
    expect(localesOf(group("or", [english, czech]))).toEqual([
      "cs-CZ",
      "en-US",
    ]);
    expect(localesOf(group("or", [english, withAccount]))).toEqual([
      "cs-CZ",
      "en-US",
    ]);
    expect(
      localesOf(
        group("or", [group("and", [english, tagged]), group("and", [english])])
      )
    ).toEqual(["en-US"]);
  });

  test("allows no locale when the audience matches nobody", () => {
    expect(localesOf(group("and", [english, czech]))).toEqual([]);
    expect(localesOf(group("or", []))).toEqual([]);
    expect(localesOf(group("and", []))).toEqual(["cs-CZ", "en-US"]);
  });
});

describe("audienceSingleLocale", () => {
  const english = { _tag: "Locale", locales: ["en-US"] } as const;

  test("finds the only locale a nested filter allows", () => {
    expect(audienceSingleLocale(english)).toBe("en-US");
    expect(audienceSingleLocale(group("and", [withAccount, czech]))).toBe(
      "cs-CZ"
    );
    expect(audienceSingleLocale(group("and", [group("and", [english])]))).toBe(
      "en-US"
    );
    expect(audienceSingleLocale(group("or", [english, english]))).toBe("en-US");
  });

  test("has none when the filter allows several locales or none", () => {
    expect(
      audienceSingleLocale({ _tag: "Locale", locales: ["cs-CZ", "en-US"] })
    ).toBeUndefined();
    expect(
      audienceSingleLocale(group("or", [english, withAccount]))
    ).toBeUndefined();
    expect(
      audienceSingleLocale(group("and", [english, czech]))
    ).toBeUndefined();
  });
});
