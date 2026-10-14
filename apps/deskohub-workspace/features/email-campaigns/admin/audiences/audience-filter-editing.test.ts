import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  type AudienceFilter,
  audienceFilterSchema,
} from "../../audience-filter";
import {
  type AudienceFilterGroup,
  appendFilter,
  asRootGroup,
  newCondition,
  newNestedGroup,
  removeFilterAt,
  replaceFilterAt,
  setReservationCriteria,
  toggleLocale,
} from "./audience-filter-editing";

const decodeFilter = Schema.decodeUnknownSync(audienceFilterSchema);

const emptyRoot: AudienceFilterGroup = {
  _tag: "Group",
  operator: "and",
  filters: [],
};

describe("asRootGroup", () => {
  test("keeps a stored group", () => {
    expect(asRootGroup(emptyRoot)).toBe(emptyRoot);
  });

  test("wraps a bare condition in an AND group", () => {
    const condition: AudienceFilter = { _tag: "Account", hasAccount: false };
    expect(asRootGroup(condition)).toEqual({
      _tag: "Group",
      operator: "and",
      filters: [condition],
    });
  });
});

describe("nested groups", () => {
  test("a nested group flips its parent's operator", () => {
    expect(newNestedGroup(emptyRoot).operator).toBe("or");
    expect(newNestedGroup({ ...emptyRoot, operator: "or" }).operator).toBe(
      "and"
    );
  });

  test("adds, edits and removes conditions inside a nested group", () => {
    const withGroup = appendFilter(
      appendFilter(emptyRoot, newCondition("Locale")),
      newNestedGroup(emptyRoot)
    );
    const nested = withGroup.filters[1] as AudienceFilterGroup;
    const filledNested = appendFilter(
      appendFilter(nested, { _tag: "DotyposTag", tag: "coworker" }),
      { _tag: "DotyposTag", tag: "rpg" }
    );
    const root = replaceFilterAt(withGroup, 1, filledNested);

    expect(root.filters[1]).toEqual({
      _tag: "Group",
      operator: "or",
      filters: [
        { _tag: "DotyposTag", tag: "coworker" },
        { _tag: "DotyposTag", tag: "rpg" },
      ],
    });

    const trimmed = replaceFilterAt(root, 1, removeFilterAt(filledNested, 0));
    expect((trimmed.filters[1] as AudienceFilterGroup).filters).toEqual([
      { _tag: "DotyposTag", tag: "rpg" },
    ]);
    expect(removeFilterAt(trimmed, 1).filters).toEqual([
      { _tag: "Locale", locales: ["cs-CZ"] },
    ]);
  });

  test("edits never mutate the previous tree", () => {
    const before = appendFilter(emptyRoot, newCondition("Account"));
    const snapshot = structuredClone(before);
    replaceFilterAt(before, 0, { _tag: "Account", hasAccount: false });
    removeFilterAt(before, 0);
    appendFilter(before, newNestedGroup(before));
    expect(before).toEqual(snapshot);
  });
});

describe("toggleLocale", () => {
  test("checking a locale adds it", () => {
    expect(toggleLocale(["cs-CZ"], "en-US", true)).toEqual(["cs-CZ", "en-US"]);
  });

  test("unchecking a locale removes it", () => {
    expect(toggleLocale(["cs-CZ", "en-US"], "cs-CZ", false)).toEqual(["en-US"]);
  });

  test("refuses to leave no locale", () => {
    expect(toggleLocale(["cs-CZ"], "cs-CZ", false)).toBeUndefined();
  });
});

describe("setReservationCriteria", () => {
  const reservation = {
    _tag: "Reservation",
    presence: "has",
    dateBasis: "visit",
  } as const;

  test("stores filled criteria", () => {
    expect(
      setReservationCriteria(reservation, {
        from: "2026-06-01",
        to: "2026-09-30",
        status: "complete",
      })
    ).toEqual({
      ...reservation,
      from: "2026-06-01",
      to: "2026-09-30",
      status: "complete",
    });
  });

  test("drops criteria cleared to empty", () => {
    const filled = setReservationCriteria(reservation, {
      from: "2026-06-01",
      status: "cancelled",
    });
    const cleared = setReservationCriteria(filled, {
      from: "",
      status: undefined,
    });
    expect(cleared).toEqual(reservation);
    expect(Object.keys(cleared)).not.toContain("from");
    expect(Object.keys(cleared)).not.toContain("status");
  });
});

describe("serialization to the domain filter schema", () => {
  test("every new condition has the schema's shape", () => {
    for (const tag of [
      "Reservation",
      "Locale",
      "DotyposTag",
      "DiscountGroup",
      "Account",
    ] as const) {
      expect(newCondition(tag)._tag).toBe(tag);
    }
  });

  test("a built nested tree decodes unchanged", () => {
    const nested = appendFilter(
      appendFilter(newNestedGroup(emptyRoot), {
        _tag: "DotyposTag",
        tag: "coworker",
      }),
      setReservationCriteria(
        { _tag: "Reservation", presence: "has", dateBasis: "visit" },
        { from: "2026-06-01", to: "2026-09-30" }
      )
    );
    const root = [
      newCondition("Account"),
      {
        _tag: "Locale",
        locales: toggleLocale(["cs-CZ"], "en-US", true) ?? ["cs-CZ"],
      },
      nested,
      { _tag: "DiscountGroup", discountGroupId: "42" },
    ].reduce<AudienceFilterGroup>(
      (group, filter) => appendFilter(group, filter as AudienceFilter),
      emptyRoot
    );

    expect(decodeFilter(root)).toEqual(root);
  });

  test("untouched placeholder conditions fail the schema", () => {
    expect(() =>
      decodeFilter(appendFilter(emptyRoot, newCondition("DotyposTag")))
    ).toThrow();
    expect(() =>
      decodeFilter(appendFilter(emptyRoot, newCondition("DiscountGroup")))
    ).toThrow();
  });
});
