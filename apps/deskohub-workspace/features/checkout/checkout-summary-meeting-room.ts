import {
  type CheckoutSummary,
  checkoutSummaryDiscountSchema,
  checkoutSummaryOrderSectionSchema,
  checkoutSummarySchema,
  checkoutSummaryTotalSectionSchema,
} from "@/features/checkout/checkout-summary";
import {
  meetingRoomCheckoutSummaryDiscountedProductItemSchema,
  meetingRoomCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-meeting-room-item";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import type { MeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import {
  getMeetingRoomSetupStartsAt,
  type MeetingRoomEarlySetup,
} from "@/features/reservation/meeting-room-early-setup";
import { moneyWithValue } from "@/shared/money/money";
import type { Instant } from "@/shared/utils/temporal";

/** The booking a meeting-room summary lists its early setup from. */
type MeetingRoomSummaryReservation = MeetingRoomEarlySetup & {
  readonly startsAt: Instant;
};

/**
 * A meeting-room booking's itemized price. Given the booking, the room line
 * also says when an early-setup customer may come in, at no cost; an
 * advertised price has no booked start and lists the room alone.
 */
export const getMeetingRoomCheckoutSummary = (
  quote: MeetingRoomReservationQuote,
  reservation?: MeetingRoomSummaryReservation
): CheckoutSummary => {
  const [item] = quote.items;
  const product: WorkspaceProductIdentity = {
    kind: item.type,
    duration: item.duration,
  };
  const key = `product:${getWorkspaceProductKey(product)}` as const;
  const earlySetup = reservation?.earlySetup === true && {
    earlySetup: {
      startsAt: getMeetingRoomSetupStartsAt(reservation.startsAt),
      amount: moneyWithValue(0, quote.payment.expectedPrice),
    },
  };
  const summaryDiscounts = quote.payment.discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ amount, discount })
  );
  const productItem =
    summaryDiscounts.length > 0
      ? meetingRoomCheckoutSummaryDiscountedProductItemSchema.make({
          key,
          product,
          ...earlySetup,
          amount: quote.payment.expectedPrice,
          originalAmount: quote.payment.undiscountedPrice,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : meetingRoomCheckoutSummaryProductItemSchema.make({
          key,
          product,
          ...earlySetup,
          amount: quote.payment.undiscountedPrice,
        });
  const orderSection = checkoutSummaryOrderSectionSchema.make({
    key: "order",
    items: [productItem],
    total: quote.payment.expectedPrice,
  });
  const totalSection = checkoutSummaryTotalSectionSchema.make({
    key: "total",
    items: [
      {
        key: "total:final",
        amount: quote.payment.expectedPrice,
      },
    ],
    total: quote.payment.expectedPrice,
  });

  return checkoutSummarySchema.make({
    sections: [orderSection, totalSection],
    total: quote.payment.expectedPrice,
  });
};
