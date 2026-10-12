import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/email/testing";
import { Effect, Schema } from "effect";
import { getWorkspaceMeetingRoomPriceForDuration } from "@/features/checkout/product-catalog";
import { calendarSaleDiscountServiceLayer } from "@/features/discounts/calendar-sale.test-utils";
import {
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import type { DiscountService } from "@/features/discounts/discount.service";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import {
  getMeetingRoomAdvertisedPriceReservation,
  normalizeMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { meetingRoomCheckoutPricing } from "./meeting-room-checkout-pricing";

const testEmailAddressForAda = testEmailAddress("ada");

const meetingRoomDuration = { unit: "hour", amount: 4 } as const;
const meetingRoomProduct = {
  kind: "meeting-room",
  duration: meetingRoomDuration,
} as const;
const money = getWorkspaceMeetingRoomPriceForDuration(meetingRoomDuration);
const discountId = Schema.decodeUnknownSync(discountIdSchema)("summer-sale");
const dotyposCustomerId = Schema.decodeUnknownSync(dotyposCustomerIdSchema)(
  "customer-id"
);

const advertisementQuote = discountAdvertisementQuoteCodec.make({
  product: meetingRoomProduct,
  discountableSubtotal: money,
  discounts: [
    {
      discount: {
        id: discountId,
        label: "Summer sale",
        adjustment: { kind: "percentage", basisPoints: 5000 },
      },
      subtotalBefore: money,
      amount: { ...money, value: money.value / 2 },
      subtotalAfter: { ...money, value: money.value / 2 },
    },
  ],
  totalDiscount: { ...money, value: money.value / 2 },
  discountedSubtotal: { ...money, value: money.value / 2 },
});

const reservation = await normalizeMeetingRoomReservationOrder({
  kind: "meeting-room",
  duration: meetingRoomDuration,
  reservationDate: "2099-06-10",
  startsAt: "2099-06-10T10:00",
  endsAt: "2099-06-10T14:00",
  name: "Ada Lovelace",
  email: testEmailAddressForAda,
  phone: "+420 777 777 777",
}).pipe(Effect.runPromise);
const advertisedReservation =
  getMeetingRoomAdvertisedPriceReservation(reservation);

const saleLastDay = getCurrentWorkspaceDate().add({ days: 1 });
const calendarSaleDiscounts = calendarSaleDiscountServiceLayer({
  calendarId: "meeting-room-midnight",
  firstDay: saleLastDay.subtract({ days: 2 }),
  lastDay: saleLastDay,
  labels: { "en-US": "Meeting-room sale", "cs-CZ": "Sleva na zasedačku" },
  products: [{ kind: "meeting-room" }],
});

const runWithDiscounts = <A, E>(
  effect: Effect.Effect<A, E, DiscountService>,
  discounts: ReturnType<typeof DiscountServiceMock>
) => effect.pipe(Effect.provide(discounts), Effect.runPromise);

describe("meeting-room checkout pricing", () => {
  test("quotes anonymous discounts from the family product and Prague date", async () => {
    const discoverAdvertisedDiscounts = mock(() =>
      Effect.succeed(advertisementQuote)
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
        });
      }),
      DiscountServiceMock({ discoverAdvertisedDiscounts })
    );

    expect(discoverAdvertisedDiscounts).toHaveBeenCalledWith({
      product: meetingRoomProduct,
      discountableSubtotal: money,
      lastServiceDate: "2099-06-10",
      locale: "en-US",
      bookedAt: expect.any(Temporal.Instant),
    });
    expect(result.quote.payment.expectedPrice).toEqual(
      advertisementQuote.discountedSubtotal
    );
    expect(result.quote.fingerprint).not.toBeEmpty();
  });

  test.each([
    ["crosses midnight past the sale's last day", "22:00", "02:00", 0],
    ["ends exactly at midnight after the sale's last day", "20:00", "00:00", 1],
  ] as const)(
    "applies a calendar sale only when a 4-hour booking %s",
    async (_label, startTime, endTime, expectedDiscounts) => {
      const nextDay = saleLastDay.add({ days: 1 });
      const order = await normalizeMeetingRoomReservationOrder({
        kind: "meeting-room",
        duration: meetingRoomDuration,
        reservationDate: saleLastDay.toString(),
        startsAt: `${saleLastDay}T${startTime}`,
        endsAt: `${nextDay}T${endTime}`,
        name: "Ada Lovelace",
        email: testEmailAddressForAda,
        phone: "+420 777 777 777",
      }).pipe(Effect.runPromise);

      const result = await Effect.gen(function* () {
        const pricing = yield* meetingRoomCheckoutPricing;
        const advertised = yield* pricing.quoteAdvertisement({
          reservation: getMeetingRoomAdvertisedPriceReservation(order),
          locale: "en-US",
        });
        const payment = yield* pricing.affirmForPayment({
          reservation: order,
          locale: "en-US",
          bookedAt: Temporal.Now.instant(),
          dotyposCustomerId,
          quote: advertised.quote,
        });
        return { advertised, payment };
      }).pipe(Effect.provide(calendarSaleDiscounts), Effect.runPromise);

      expect(result.advertised.quote.payment.discounts).toHaveLength(
        expectedDiscounts
      );
      expect(result.payment.quote.payment.discounts).toHaveLength(
        expectedDiscounts
      );
    }
  );
});
