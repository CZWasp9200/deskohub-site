import { describe, expect, it } from "bun:test";
import { daysLeftForm, membershipDaysLeft } from "./membership-days-left";

describe("membership days left", () => {
  const now = new Date("2026-11-15T10:00:00Z");

  it("counts a started day as a whole day", () => {
    expect(membershipDaysLeft(new Date("2026-11-15T12:00:00Z"), now)).toBe(1);
    expect(membershipDaysLeft(new Date("2026-11-18T10:00:00Z"), now)).toBe(3);
    expect(membershipDaysLeft(new Date("2026-11-18T10:00:01Z"), now)).toBe(4);
  });

  it("picks the Czech plural form", () => {
    expect(daysLeftForm(1, "cs-CZ")).toBe("one");
    expect(daysLeftForm(3, "cs-CZ")).toBe("few");
    expect(daysLeftForm(5, "cs-CZ")).toBe("other");
    expect(daysLeftForm(23, "cs-CZ")).toBe("other");
  });

  it("picks the English plural form", () => {
    expect(daysLeftForm(1, "en-US")).toBe("one");
    expect(daysLeftForm(3, "en-US")).toBe("other");
  });
});
