import { describe, expect, it } from "bun:test";
import {
  currentMembership,
  daysLeftForm,
  membershipDaysLeft,
  membershipLastMoment,
} from "./membership-period";

const at = (iso: string) => new Date(iso);
const period = (planName: string, startsAt: string, endsAt: string) => ({
  planName,
  startsAt: at(startsAt),
  endsAt: at(endsAt),
});

describe("currentMembership", () => {
  const now = at("2026-11-16T10:00:00Z");

  it("shows the running plan and extends it with a renewal straight after", () => {
    const current = currentMembership(
      [
        period("Měsíční", "2026-11-01T10:00:00Z", "2026-12-01T10:00:00Z"),
        period("Roční", "2026-12-01T10:00:00Z", "2027-12-01T10:00:00Z"),
      ],
      now
    );
    expect(current).toEqual({
      planName: "Měsíční",
      endsAt: at("2027-12-01T10:00:00Z"),
    });
  });

  it("does not count a period that starts later", () => {
    const current = currentMembership(
      [period("Měsíční", "2026-11-26T10:00:00Z", "2026-12-26T10:00:00Z")],
      now
    );
    expect(current).toBeNull();
  });

  it("stops the end date at a gap between periods", () => {
    const current = currentMembership(
      [
        period("Měsíční", "2026-10-21T10:00:00Z", "2026-11-21T10:00:00Z"),
        period("Měsíční", "2026-12-11T10:00:00Z", "2027-01-11T10:00:00Z"),
      ],
      now
    );
    expect(current?.endsAt).toEqual(at("2026-11-21T10:00:00Z"));
  });

  it("is null when every period has ended", () => {
    const current = currentMembership(
      [period("Měsíční", "2026-09-01T10:00:00Z", "2026-10-01T10:00:00Z")],
      now
    );
    expect(current).toBeNull();
  });
});

describe("membershipDaysLeft", () => {
  it("counts a membership ending at midnight as ending the day before", () => {
    // Ends 26 October 00:00 in Prague: 25 October is its last day.
    const endsAt = at("2026-10-25T22:00:00Z");
    expect(membershipDaysLeft(endsAt, at("2026-10-24T22:30:00Z"))).toBe(1);
    expect(membershipLastMoment(endsAt).toISOString()).toBe(
      "2026-10-25T21:59:59.999Z"
    );
  });

  it("counts calendar days in Prague, today included", () => {
    // Ends 14 December 14:00 in Prague.
    const endsAt = at("2026-12-14T13:00:00Z");
    expect(membershipDaysLeft(endsAt, at("2026-12-13T13:00:00Z"))).toBe(2);
    expect(membershipDaysLeft(endsAt, at("2026-12-13T23:30:00Z"))).toBe(1);
  });
});

describe("daysLeftForm", () => {
  it("picks the Czech and English plural forms", () => {
    expect(daysLeftForm(1, "cs-CZ")).toBe("one");
    expect(daysLeftForm(3, "cs-CZ")).toBe("few");
    expect(daysLeftForm(5, "cs-CZ")).toBe("other");
    expect(daysLeftForm(1, "en-US")).toBe("one");
    expect(daysLeftForm(3, "en-US")).toBe("other");
  });
});
