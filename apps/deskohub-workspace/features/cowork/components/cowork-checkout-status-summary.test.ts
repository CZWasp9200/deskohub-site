import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { m } from "@/features/i18n";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateTimeRange,
} from "@/features/reservation/reservation-date";
import { getCoworkCheckoutStatusSummary } from "./cowork-checkout-status-summary";

const reservedDesk = (reservedFrom: string, reservedUntil: string) =>
  ({
    kind: "cowork",
    entryTier: "reserved-desk",
    coffee: false,
    price: { value: 41_000, exponent: 2, currency: "CZK" },
    reservedFrom: Temporal.Instant.from(reservedFrom),
    reservedUntil: Temporal.Instant.from(reservedUntil),
  }) as const;

const dateRow = (summary: ReturnType<typeof reservedDesk>) =>
  getCoworkCheckoutStatusSummary(summary, "en-US").rows.find(
    ({ label }) =>
      label === m.checkoutStatusSummaryDateLabel({}, { locale: "en-US" })
  )?.value;

describe("getCoworkCheckoutStatusSummary", () => {
  test("dates an overnight Reserved Desk stay from its start to its end", () => {
    const overnight = reservedDesk(
      "2099-07-01T10:00:00Z",
      "2099-07-02T10:00:00Z"
    );

    expect(dateRow(overnight)).toBe(
      formatReservationDisplayDateTimeRange(
        overnight.reservedFrom,
        overnight.reservedUntil,
        "en-US"
      )
    );
  });

  test("dates a day stay by its arrival date", () => {
    const day = reservedDesk("2099-06-30T22:00:00Z", "2099-07-01T22:00:00Z");

    expect(dateRow(day)).toBe(
      formatReservationDisplayDate(day.reservedFrom, "en-US")
    );
  });
});
