import {
  type CheckoutSummary,
  type CheckoutSummaryOrderItem,
  checkoutSummaryDiscountSchema,
  checkoutSummaryOrderSectionSchema,
  checkoutSummarySchema,
  checkoutSummaryTotalSectionSchema,
} from "@/features/checkout/checkout-summary";
import {
  coworkCheckoutSummaryDiscountedProductItemSchema,
  coworkCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-cowork-item";
import type {
  WorkspaceCoworkProductTier,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import type { CoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";

type CoworkReservationSummaryInput = {
  readonly entryTier: WorkspaceCoworkProductTier;
  readonly monitorOption?: WorkspaceProductMonitorOption | "" | undefined;
};

const getCoworkSummaryMonitorOption = (
  reservation: CoworkReservationSummaryInput
) => reservation.monitorOption || undefined;

export const getCoworkCheckoutSummary = (
  reservation: CoworkReservationSummaryInput,
  quote: CoworkReservationQuote
): CheckoutSummary => {
  const [productQuoteItem, addonQuoteItem] = quote.items;
  const product = {
    kind: productQuoteItem.type,
    tier: productQuoteItem.tier,
  } as const;
  const productKey = `product:${getWorkspaceProductKey(product)}` as const;
  const summaryDiscounts = quote.payment.discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ discount, amount })
  );
  const discountedProductPrice =
    quote.payment.discounts.at(-1)?.subtotalAfter ?? productQuoteItem.amount;
  const productItem =
    summaryDiscounts.length > 0
      ? coworkCheckoutSummaryDiscountedProductItemSchema.make({
          key: productKey,
          product,
          amount: discountedProductPrice,
          originalAmount: productQuoteItem.amount,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : coworkCheckoutSummaryProductItemSchema.make({
          key: productKey,
          product,
          amount: productQuoteItem.amount,
        });
  const orderItems: CheckoutSummaryOrderItem[] = [productItem];

  if (addonQuoteItem?.type === "coffee") {
    orderItems.push({
      key: "addon:coffee",
      amount: addonQuoteItem.amount,
    });
  }

  if (addonQuoteItem?.type === "workstation") {
    // The chosen monitor setup is the workstation's configuration: it
    // changes the reserved desk, never the price, so it rides on the
    // workstation's own line.
    const monitorOption = getCoworkSummaryMonitorOption(reservation);
    orderItems.push({
      key: "addon:workstation",
      amount: addonQuoteItem.amount,
      ...(monitorOption && { monitorOption }),
    });
  }

  const orderSection = checkoutSummaryOrderSectionSchema.make({
    key: "order",
    items: orderItems,
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
