import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { advertiseOffice } from "@/features/reservation/advertised-price.test-utils";
import {
  findOfficeSeatAdvertisedPriceRequest,
  getOfficeSeatAdvertisedPriceRequests,
} from "@/features/reservation/office-advertised-price";
import { plainDateStringSchema } from "@/shared/utils/temporal";

const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);
const threeSeats = findOfficeSeatAdvertisedPriceRequest(
  getOfficeSeatAdvertisedPriceRequests({
    startsOn: decodePlainDate("2099-08-10"),
    endsOn: decodePlainDate("2099-08-12"),
    locale: "en-US",
    seatCapacity: 4,
  }),
  3
);
if (!threeSeats) throw new Error("Expected a three-seat request");

describe("getOfficeCheckoutSummary", () => {
  test("gives the office line the daily rates its access and seat amounts count", () => {
    const { summary } = advertiseOffice(threeSeats).advertisedPrice;
    const line = summary.sections[0]?.items[0];
    if (!(line && "dailyAccessRate" in line && line.dailyAccessRate))
      throw new Error("Expected the office line's daily access rate");
    if (!line.dailySeatRate) throw new Error("Expected the daily seat rate");

    expect(line.dayCount).toBe(3);
    expect(line.dailyAccessRate.value * line.dayCount).toBe(
      line.accessAmount.value
    );
    expect(line.dailySeatRate.value * line.dayCount).toBe(
      line.seatAmount.value
    );
    expect(line.dailyAccessRate.currency).toBe(line.accessAmount.currency);
  });
});
