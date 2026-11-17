import { Schema } from "effect";
import { Money } from "./customer-account-api";

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

/**
 * How a discount is worked out: a percentage of the price it applies to, in
 * basis points (`2000` is 20%), or a fixed amount off.
 */
export const CustomerDiscountAdjustment = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("percentage"),
    basisPoints: Schema.Int,
  }),
  Schema.Struct({ kind: Schema.Literal("fixed"), amount: Money }),
]).annotate({ identifier: "CustomerDiscountAdjustment" });
export type CustomerDiscountAdjustment = typeof CustomerDiscountAdjustment.Type;

/** A discount a summary item includes. */
export const CustomerCheckoutSummaryDiscount = Schema.Struct({
  discount: Schema.Struct({
    id: Schema.String,
    /** The discount's name, in the request's language. */
    label: Schema.String,
    adjustment: CustomerDiscountAdjustment,
    /** When the discount stops applying, while it has an end. */
    expiresAt: Schema.optionalKey(isoInstant),
    /** When to start counting down to `expiresAt`. */
    countdownStartsAt: Schema.optionalKey(isoInstant),
  }),
  /** What the discount takes off the item. */
  amount: Money,
}).annotate({ identifier: "CustomerCheckoutSummaryDiscount" });
export type CustomerCheckoutSummaryDiscount =
  typeof CustomerCheckoutSummaryDiscount.Type;

/** One line of a checkout summary. */
export const CustomerCheckoutSummaryItem = Schema.Struct({
  /**
   * What the line is: `product:<product key>`, `addon:coffee`,
   * `addon:workstation`, `monitor:<option>`, or `total:final`.
   */
  key: Schema.String,
  /** The line's price after its discounts. */
  amount: Money,
  /** The price before discounts, on a discounted product line. */
  originalAmount: Schema.optionalKey(Money),
  discounts: Schema.optionalKey(Schema.Array(CustomerCheckoutSummaryDiscount)),
  /** Office product line only: the days booked. */
  dayCount: Schema.optionalKey(Schema.Int),
  /** Office product line only: the seats booked. */
  seats: Schema.optionalKey(Schema.Int),
  /** Office product line only: the office access part of `amount`. */
  accessAmount: Schema.optionalKey(Money),
  /**
   * Office product line only: one seat's price for the days booked. The
   * seats' part of `amount` is this times `seats`.
   */
  seatAmount: Schema.optionalKey(Money),
  /**
   * Office product line only: every seat's price for the days booked; with
   * `accessAmount` it makes the line's price before discounts.
   */
  seatsAmount: Schema.optionalKey(Money),
  /** Office product line only: the office access price for one day. */
  dailyAccessRate: Schema.optionalKey(Money),
  /** Office product line only: one seat's price for one day. */
  dailySeatRate: Schema.optionalKey(Money),
  /**
   * Meeting-room product line only, when the customer comes early to set
   * up: when they may come in, and what it costs (it's free).
   */
  earlySetup: Schema.optionalKey(
    Schema.Struct({ startsAt: isoInstant, amount: Money })
  ),
}).annotate({ identifier: "CustomerCheckoutSummaryItem" });
export type CustomerCheckoutSummaryItem =
  typeof CustomerCheckoutSummaryItem.Type;

/**
 * Whether the company selling the booking is registered for VAT, which
 * decides whether a total carries a tax note.
 */
export const CustomerVatStatus = Schema.Literals([
  "not-vat-payer",
  "vat-payer",
]).annotate({
  identifier: "CustomerVatStatus",
  description:
    "Whether the seller is registered for VAT: a VAT payer's totals carry a tax note.",
});
export type CustomerVatStatus = typeof CustomerVatStatus.Type;

/**
 * The itemized price of a booking, as the booking pages show it: the order's
 * lines, then the total, with the seller's VAT status.
 */
export const CustomerCheckoutSummary = Schema.Struct({
  sections: Schema.Array(
    Schema.Struct({
      key: Schema.Literals(["order", "total"]),
      items: Schema.Array(CustomerCheckoutSummaryItem),
      total: Money,
    })
  ),
  total: Money,
  vatStatus: CustomerVatStatus,
}).annotate({ identifier: "CustomerCheckoutSummary" });
export type CustomerCheckoutSummary = typeof CustomerCheckoutSummary.Type;
