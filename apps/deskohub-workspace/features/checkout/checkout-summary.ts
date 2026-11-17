import { Schema } from "effect";
import {
  coworkCheckoutSummaryDiscountedProductItemSchema,
  coworkCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-cowork-item";
import {
  meetingRoomCheckoutSummaryDiscountedProductItemSchema,
  meetingRoomCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-meeting-room-item";
import {
  officeCheckoutSummaryDiscountedProductItemSchema,
  officeCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-office-item";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import { moneyEquals, nonNegativeMoneyCodec } from "@/shared/money/money";

export {
  type CheckoutSummaryDiscount,
  checkoutSummaryDiscountSchema,
} from "@/features/checkout/checkout-summary-product-item";

const checkoutSummaryCoffeeItemSchema = Schema.Struct({
  key: Schema.Literal("addon:coffee"),
  amount: nonNegativeMoneyCodec,
});

/**
 * The monitor workstation add-on: its price, and the monitor setup it is
 * configured with, which changes the reserved desk but never the price.
 */
const checkoutSummaryWorkstationItemSchema = Schema.Struct({
  key: Schema.Literal("addon:workstation"),
  amount: nonNegativeMoneyCodec,
  monitorOption: Schema.optionalKey(
    Schema.Literals(workspaceProductMonitorOptions)
  ),
});

export const checkoutSummaryOrderItemSchema = Schema.Union([
  meetingRoomCheckoutSummaryDiscountedProductItemSchema,
  meetingRoomCheckoutSummaryProductItemSchema,
  coworkCheckoutSummaryDiscountedProductItemSchema,
  coworkCheckoutSummaryProductItemSchema,
  officeCheckoutSummaryDiscountedProductItemSchema,
  officeCheckoutSummaryProductItemSchema,
  checkoutSummaryCoffeeItemSchema,
  checkoutSummaryWorkstationItemSchema,
]);

const checkoutSummaryTotalItemSchema = Schema.Struct({
  key: Schema.Literal("total:final"),
  amount: nonNegativeMoneyCodec,
});

const checkoutSummaryItemSchema = Schema.Union([
  checkoutSummaryOrderItemSchema,
  checkoutSummaryTotalItemSchema,
]);

export const checkoutSummaryOrderSectionSchema = Schema.Struct({
  key: Schema.Literal("order"),
  items: Schema.Array(checkoutSummaryOrderItemSchema),
  total: nonNegativeMoneyCodec,
});

export const checkoutSummaryTotalSectionSchema = Schema.Struct({
  key: Schema.Literal("total"),
  items: Schema.Array(checkoutSummaryTotalItemSchema),
  total: nonNegativeMoneyCodec,
});

const checkoutSummarySectionSchema = Schema.Union([
  checkoutSummaryOrderSectionSchema,
  checkoutSummaryTotalSectionSchema,
]);

export const checkoutSummarySchema = Schema.Struct({
  sections: Schema.Array(checkoutSummarySectionSchema),
  total: nonNegativeMoneyCodec,
}).annotate({
  identifier: "CheckoutSummary",
  description: "Public itemized Workspace checkout summary.",
});

export const checkoutSummaryChangedKeysSchema = Schema.Struct({
  sectionKeys: Schema.Array(Schema.String),
  itemKeys: Schema.Array(Schema.String),
});

type CheckoutSummaryItem = typeof checkoutSummaryItemSchema.Type;
export type CheckoutSummaryOrderItem =
  typeof checkoutSummaryOrderItemSchema.Type;
export type CheckoutSummary = typeof checkoutSummarySchema.Type;
export type CheckoutSummaryChangedKeys =
  typeof checkoutSummaryChangedKeysSchema.Type;

const getCanonicalSummaryItem = (item: CheckoutSummaryItem) => ({
  key: item.key,
  amount: item.amount,
  ...("product" in item && { product: item.product }),
  ...("dayCount" in item && { dayCount: item.dayCount }),
  ...("seats" in item && { seats: item.seats }),
  ...("accessAmount" in item && { accessAmount: item.accessAmount }),
  ...("seatAmount" in item && { seatAmount: item.seatAmount }),
  ...("seatsAmount" in item && { seatsAmount: item.seatsAmount }),
  ...("monitorOption" in item && { monitorOption: item.monitorOption }),
  ...("originalAmount" in item && {
    originalAmount: item.originalAmount,
    discounts: item.discounts,
  }),
});

const getSummarySectionMap = (summary: CheckoutSummary) =>
  new Map(summary.sections.map((section) => [section.key, section]));

const getSummaryItemMap = (summary: CheckoutSummary) =>
  new Map(
    summary.sections.flatMap((section) =>
      section.items.map((item) => [item.key, item] as const)
    )
  );

const hasCheckoutSummaryItemChanged = (
  previousItem: CheckoutSummaryItem | undefined,
  nextItem: CheckoutSummaryItem | undefined
) =>
  JSON.stringify(previousItem && getCanonicalSummaryItem(previousItem)) !==
  JSON.stringify(nextItem && getCanonicalSummaryItem(nextItem));

export const getCheckoutSummaryChangedKeys = (
  previous: CheckoutSummary,
  next: CheckoutSummary
): CheckoutSummaryChangedKeys => {
  const previousSections = getSummarySectionMap(previous);
  const nextSections = getSummarySectionMap(next);
  const sectionKeys = Array.from(
    new Set([...previousSections.keys(), ...nextSections.keys()])
  )
    .filter((key) => {
      const previousSection = previousSections.get(key);
      const nextSection = nextSections.get(key);
      return !moneyEquals(previousSection?.total, nextSection?.total);
    })
    .sort();
  const previousItems = getSummaryItemMap(previous);
  const nextItems = getSummaryItemMap(next);
  const itemKeys = Array.from(
    new Set([...previousItems.keys(), ...nextItems.keys()])
  )
    .filter((key) => {
      const previousItem = previousItems.get(key);
      const nextItem = nextItems.get(key);
      return hasCheckoutSummaryItemChanged(previousItem, nextItem);
    })
    .sort();

  return { sectionKeys, itemKeys };
};
