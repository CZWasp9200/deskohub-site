import { describe, expect, test } from "bun:test";
import type { AudienceCountOperatorType } from "@deskohub/workspace-admin-api";
import type { AudienceCondition, AudienceFilter } from "../audience-filter";
import type { DatePeriod } from "../date-period";
import {
  describeAudienceFilter,
  describeCount,
  hasPeriodEndingAtEvaluation,
} from "./audience-filter-summary";
import { describeDatePeriod } from "./date-period-phrases";

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
const czech: AudienceCondition = {
  attribute: "locale",
  _tag: "Condition",
  operator: "anyOf",
  value: ["cs-CZ"],
};

const reservations = (
  operator: AudienceCountOperatorType,
  value: number,
  params: Partial<
    Extract<AudienceCondition, { attribute: "reservationCount" }>["params"]
  > = {}
): AudienceCondition => ({
  attribute: "reservationCount",
  _tag: "Condition",
  params: { dateBasis: "visit", period: { _tag: "AnyTime" }, ...params },
  operator,
  value,
});

const describe_ = (filter: AudienceFilter) => describeAudienceFilter(filter);

describe("describeAudienceFilter", () => {
  test("describes empty groups", () => {
    expect(describe_(and())).toBe("Every customer Workspace knows");
    expect(describe_(or())).toBe("Nobody");
  });

  test("describes counts naturally", () => {
    expect(describe_(reservations("gt", 0))).toBe(
      "Customers who have any booked reservations"
    );
    expect(describe_(reservations("eq", 0))).toBe(
      "Customers who have no booked reservations"
    );
    expect(
      describe_(
        reservations("gte", 2, {
          dateBasis: "booking",
          period: { _tag: "Last", count: 1, unit: "month" },
          status: "cancelled",
        })
      )
    ).toBe(
      "Customers who have at least 2 cancelled reservations confirmed in the last month"
    );
    expect(
      describe_({
        attribute: "campaignEmailCount",
        _tag: "Condition",
        params: {
          purpose: "marketing",
          period: { _tag: "Last", count: 10, unit: "day" },
        },
        operator: "eq",
        value: 0,
      })
    ).toBe(
      "Customers who received no marketing campaign emails in the last 10 days"
    );
  });

  test.each<[AudienceCountOperatorType, number, string]>([
    ["eq", 0, "no emails"],
    ["eq", 1, "exactly 1 email"],
    ["ne", 0, "any emails"],
    ["ne", 2, "other than 2 emails"],
    ["lt", 1, "no emails"],
    ["lt", 3, "fewer than 3 emails"],
    ["lte", 0, "no emails"],
    ["lte", 2, "at most 2 emails"],
    ["gt", 0, "any emails"],
    ["gt", 1, "more than 1 email"],
    ["gte", 0, "any number of emails"],
    ["gte", 1, "any emails"],
    ["gte", 3, "at least 3 emails"],
    ["gt", Number.NaN, "… emails"],
  ])("phrases %s %d as “%s”", (operator, value, phrase) => {
    expect(describeCount(operator, value, { one: "email", other: "emails" })).toBe(
      phrase
    );
  });

  test("describes date attributes", () => {
    expect(
      describe_({
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "notIn",
        value: { _tag: "Last", count: 30, unit: "day" },
      })
    ).toBe(
      "Customers who have visited, with the last visit not in the last 30 days"
    );
    expect(
      describe_({ attribute: "lastVisit", _tag: "Condition", operator: "none" })
    ).toBe("Customers who have never visited");
    expect(
      describe_({
        attribute: "accountCreated",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Since", date: "2026-09-01" },
      })
    ).toBe("Customers who created a Workspace account since 2026-09-01");
  });

  test("describes set and boolean attributes, with names for known groups", () => {
    expect(
      describeAudienceFilter(
        and(
          czech,
          {
            attribute: "dotyposTags",
            _tag: "Condition",
            operator: "noneOf",
            value: ["vip", "staff"],
          },
          {
            attribute: "discountGroup",
            _tag: "Condition",
            operator: "anyOf",
            value: ["1", "2"],
          },
          { attribute: "hasAccount", _tag: "Condition", operator: "is", value: false }
        ),
        [{ id: "1", name: "Students" }]
      )
    ).toBe(
      "Customers who speak Czech and aren’t tagged “vip” or “staff” and are in discount group “Students” or 2 and have no Workspace account"
    );
  });

  test("brackets nested groups with more than one condition", () => {
    expect(describe_(and(czech, or(reservations("gt", 0), reservations("eq", 0))))).toBe(
      "Customers who speak Czech and (have any booked reservations or have no booked reservations)"
    );
  });
});

describe("describeDatePeriod", () => {
  test.each<[DatePeriod, string]>([
    [{ _tag: "AnyTime" }, "at any time"],
    [{ _tag: "Last", count: 1, unit: "week" }, "in the last week"],
    [{ _tag: "Last", count: 2, unit: "year" }, "in the last 2 years"],
    [{ _tag: "Range", from: "2026-01-01", to: "2026-03-31" }, "from 2026-01-01 to 2026-03-31"],
    [{ _tag: "Since", date: "2026-01-01" }, "since 2026-01-01"],
    [{ _tag: "Onward", date: "2026-01-01" }, "from 2026-01-01 onward"],
    [{ _tag: "Until", date: "2026-01-01" }, "until 2026-01-01"],
  ])("names %o as “%s”", (period, phrase) => {
    expect(describeDatePeriod(period)).toBe(phrase);
  });
});

describe("hasPeriodEndingAtEvaluation", () => {
  test("finds last-N and since periods anywhere in the tree", () => {
    expect(hasPeriodEndingAtEvaluation(and(czech, reservations("gt", 0)))).toBe(
      false
    );
    expect(
      hasPeriodEndingAtEvaluation(
        and(
          czech,
          or(
            reservations("gt", 0, {
              period: { _tag: "Last", count: 2, unit: "week" },
            })
          )
        )
      )
    ).toBe(true);
    expect(
      hasPeriodEndingAtEvaluation({
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Since", date: "2026-01-01" },
      })
    ).toBe(true);
    expect(
      hasPeriodEndingAtEvaluation({
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "none",
      })
    ).toBe(false);
  });
});
