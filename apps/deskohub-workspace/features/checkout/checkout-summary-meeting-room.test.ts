import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { Schema } from "effect";
import { advertiseMeetingRoom } from "@/features/reservation/advertised-price.test-utils";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { instantStringSchema } from "@/shared/utils/temporal";
import { getMeetingRoomCheckoutSummary } from "./checkout-summary-meeting-room";

const decodeInstant = Schema.decodeUnknownSync(instantStringSchema);
const [oneHour] = getMeetingRoomDurationAdvertisedPriceRequests({
  locale: "en-US",
  startDateTime: "2099-07-30T10:00",
});
if (!oneHour) throw new Error("Expected a one-hour request");

const startsAt = decodeInstant("2099-07-30T08:00:00Z");
const productLine = (
  summary: ReturnType<typeof getMeetingRoomCheckoutSummary>
) => summary.sections[0]?.items[0];

describe("getMeetingRoomCheckoutSummary", () => {
  test("gives the room line the early setup: in 15 minutes before the start, for nothing", () => {
    const { quote } = advertiseMeetingRoom(oneHour).advertisedPrice;
    const summary = getMeetingRoomCheckoutSummary(quote, {
      startsAt,
      earlySetup: true,
    });

    expect(productLine(summary)).toMatchObject({
      earlySetup: {
        startsAt: "2099-07-30T07:45:00Z",
        amount: { ...quote.payment.expectedPrice, value: 0 },
      },
    });
    expect(summary.total).toEqual(quote.payment.expectedPrice);
  });

  test("keeps the early setup on a discounted room line, after its discounts", () => {
    const { quote } = advertiseMeetingRoom(oneHour, {
      saleExpiresAt: "2099-08-01T22:00:00.000Z",
    }).advertisedPrice;
    const line = productLine(
      getMeetingRoomCheckoutSummary(quote, { startsAt, earlySetup: true })
    );

    expect(line).toHaveProperty("discounts");
    expect(line).toHaveProperty("earlySetup.startsAt", "2099-07-30T07:45:00Z");
  });

  test("lists no early setup for a booking without one, or an advertised price", () => {
    const { quote } = advertiseMeetingRoom(oneHour).advertisedPrice;

    expect(
      productLine(getMeetingRoomCheckoutSummary(quote, { startsAt }))
    ).not.toHaveProperty("earlySetup");
    expect(
      productLine(getMeetingRoomCheckoutSummary(quote))
    ).not.toHaveProperty("earlySetup");
  });
});
