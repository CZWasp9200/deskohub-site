import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  CustomerAvailabilityQuery,
  CustomerOffering,
} from "./customer-booking-catalog-api";
import {
  CustomerBookingSelection,
  CustomerBookingSelectionQuery,
} from "./customer-booking-selection";

const strict = { onExcessProperty: "error" } as const;
const reservedDesk = {
  family: "cowork",
  date: "2099-06-10",
  tier: "reserved-desk",
} as const;

describe("Reserved Desk stay in the customer booking contract", () => {
  test("decodes a selection without a stay, as older apps send it", () => {
    expect(
      Schema.decodeUnknownSync(CustomerBookingSelection)(reservedDesk, strict)
    ).toEqual(reservedDesk);
  });

  test("accepts an overnight stay on strict selection, query, and availability requests", () => {
    const overnight = { ...reservedDesk, stay: "overnight" } as const;
    expect(
      Schema.decodeUnknownSync(CustomerBookingSelection)(overnight, strict)
    ).toEqual(overnight);
    expect(
      Schema.decodeUnknownSync(CustomerBookingSelectionQuery)(overnight, strict)
    ).toEqual(overnight);
    expect(
      Schema.decodeUnknownSync(CustomerAvailabilityQuery)(
        { entryTier: "reserved-desk", date: "2099-06-10", stay: "overnight" },
        strict
      )
    ).toMatchObject({ stay: "overnight" });
  });

  test("rejects an unknown stay", () => {
    expect(() =>
      Schema.decodeUnknownSync(CustomerBookingSelection)(
        { ...reservedDesk, stay: "week" },
        strict
      )
    ).toThrow();
  });

  test("decodes a cowork offering with and without the overnight stay", () => {
    const price = { value: 41_000, exponent: 2, currency: "CZK" };
    const offering = {
      family: "cowork",
      tier: "reserved-desk",
      name: "Reserved Desk",
      description: "A desk of your own",
      usage: "Any time on the reserved date",
      price,
      advertisedPrice: {
        price,
        discount: { value: 0, exponent: 2, currency: "CZK" },
      },
      bookableDates: { earliest: "2099-06-10", latest: "2099-12-10" },
      addOns: [],
    };
    const decode = Schema.decodeUnknownSync(CustomerOffering);
    expect("overnightStay" in decode(offering)).toBe(false);
    expect(
      decode({
        ...offering,
        overnightStay: { startTime: "12:00", endTime: "12:00" },
      })
    ).toMatchObject({
      overnightStay: { startTime: "12:00", endTime: "12:00" },
    });
  });
});
