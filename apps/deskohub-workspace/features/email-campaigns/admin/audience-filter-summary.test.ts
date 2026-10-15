import { describe, expect, test } from "bun:test";
import type { AudienceFilter } from "../audience-filter";
import { describeAudienceFilter } from "./audience-filter-summary";

const and = (...filters: AudienceFilter[]): AudienceFilter => ({
  _tag: "Group",
  operator: "and",
  filters,
});
const or = (...filters: AudienceFilter[]): AudienceFilter => ({
  _tag: "Group",
  operator: "or",
  filters,
});
const czech: AudienceFilter = { _tag: "Locale", locales: ["cs-CZ"] };

describe("describeAudienceFilter", () => {
  test("describes empty groups", () => {
    expect(describeAudienceFilter(and())).toBe(
      "Every customer Workspace knows"
    );
    expect(describeAudienceFilter(or())).toBe("Nobody");
  });

  test("describes each condition as a sentence", () => {
    expect(
      describeAudienceFilter({ _tag: "Locale", locales: ["cs-CZ", "en-US"] })
    ).toBe("Customers who speak Czech or English");
    expect(describeAudienceFilter({ _tag: "Account", hasAccount: false })).toBe(
      "Customers who have no Workspace account"
    );
    expect(describeAudienceFilter({ _tag: "DotyposTag", tag: "rpg" })).toBe(
      "Customers who are tagged “rpg”"
    );
  });

  test("describes reservation criteria", () => {
    expect(
      describeAudienceFilter({
        _tag: "Reservation",
        presence: "has",
        dateBasis: "visit",
        from: "2026-06-01",
        to: "2026-09-30",
      })
    ).toBe(
      "Customers who have a booked reservation visiting between 2026-06-01 and 2026-09-30"
    );
    expect(
      describeAudienceFilter({
        _tag: "Reservation",
        presence: "hasNot",
        dateBasis: "booking",
        from: "2026-01-01",
        status: "needs_refund",
      })
    ).toBe(
      "Customers who have no reservation needing a refund confirmed from 2026-01-01"
    );
    expect(
      describeAudienceFilter({
        _tag: "Reservation",
        presence: "has",
        dateBasis: "visit",
      })
    ).toBe("Customers who have a booked reservation");
    expect(
      describeAudienceFilter({
        _tag: "Reservation",
        presence: "has",
        dateBasis: "visit",
        status: "in_progress",
      })
    ).toBe("Customers who have a reservation in progress");
  });

  test("names known discount groups and falls back to the ID", () => {
    const filter: AudienceFilter = {
      _tag: "DiscountGroup",
      discountGroupId: "7",
    };
    expect(describeAudienceFilter(filter, [{ id: "7", name: "Members" }])).toBe(
      "Customers who are in discount group “Members”"
    );
    expect(describeAudienceFilter(filter)).toBe(
      "Customers who are in discount group 7"
    );
  });

  test("brackets nested groups with more than one condition", () => {
    expect(
      describeAudienceFilter(
        and(
          czech,
          or(
            { _tag: "DotyposTag", tag: "coworker" },
            { _tag: "DotyposTag", tag: "rpg" }
          ),
          or({ _tag: "Account", hasAccount: true })
        )
      )
    ).toBe(
      "Customers who speak Czech and (are tagged “coworker” or are tagged “rpg”) and have a Workspace account"
    );
  });

  test("describes empty nested groups", () => {
    expect(describeAudienceFilter(and(czech, or()))).toBe(
      "Customers who speak Czech and match nothing"
    );
  });
});
