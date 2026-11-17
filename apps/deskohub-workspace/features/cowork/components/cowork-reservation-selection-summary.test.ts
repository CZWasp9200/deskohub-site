import { describe, expect, test } from "bun:test";
import { formatReservationDisplayPlainDate } from "@/features/reservation/reservation-date";
import { getCoworkReservationSelectionSummary } from "./cowork-reservation-selection-summary";
import { formatCoworkOvernightStay } from "./cowork-stay-display";

const dateRow = (
  selection: Parameters<typeof getCoworkReservationSelectionSummary>[0]
) => getCoworkReservationSelectionSummary(selection, "en-US").rows[0]?.value;

describe("getCoworkReservationSelectionSummary", () => {
  test("shows an overnight Reserved Desk stay's exact start and end", () => {
    expect(
      dateRow({
        entryTier: "reserved-desk",
        date: "2099-07-30",
        stay: "overnight",
      })
    ).toBe(formatCoworkOvernightStay("2099-07-30", "en-US"));
  });

  test.each([
    ["a day Reserved Desk stay", "reserved-desk", undefined],
    ["an Open Space day", "open-space", "overnight"],
  ] as const)("shows %s as its date", (_, entryTier, stay) => {
    expect(dateRow({ entryTier, date: "2099-07-30", stay })).toBe(
      formatReservationDisplayPlainDate(
        Temporal.PlainDate.from("2099-07-30"),
        "en-US"
      )
    );
  });
});

describe("formatCoworkOvernightStay", () => {
  test("runs from noon on the arrival date to noon on the next date, in Prague", () => {
    // 2099-07-30 is a Thursday; Prague is on CEST (UTC+2) in July.
    const text = formatCoworkOvernightStay("2099-07-30", "cs-CZ");
    expect(text).toContain("30. 7.");
    expect(text).toContain("31. 7.");
    expect(text.match(/12:00/g)).toHaveLength(2);
  });
});
