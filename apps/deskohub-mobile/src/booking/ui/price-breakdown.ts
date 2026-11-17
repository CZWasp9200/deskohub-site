import type {
  CustomerCheckoutSummary,
  CustomerCheckoutSummaryDiscount,
  CustomerCheckoutSummaryItem,
  CustomerDiscountAdjustment,
  CustomerVatStatus,
  Money,
} from "@deskohub/workspace-customer-api";

/** What a price line charges for. */
export type PriceLineSubject =
  /** The booked product, `product:<product key>`. */
  | { readonly _tag: "Product"; readonly product: string }
  /** An office product line's access part. */
  | {
      readonly _tag: "OfficeAccess";
      readonly dayCount: number;
      /** The access price of one day, where the quote gives it. */
      readonly dailyRate?: Money;
    }
  /** An office product line's seats part. */
  | {
      readonly _tag: "OfficeSeats";
      readonly seats: number;
      readonly dayCount: number;
      /** The price of one seat for one day, where the quote gives it. */
      readonly dailySeatRate?: Money;
    }
  | { readonly _tag: "Coffee" }
  | { readonly _tag: "Workstation" }
  | { readonly _tag: "Monitor"; readonly option: string }
  /** A meeting room's early setup: the customer may come in at `startsAt`. */
  | { readonly _tag: "EarlySetup"; readonly startsAt: string }
  | { readonly _tag: "Other"; readonly key: string };

/** The subjects a summary item's key names on its own. */
export type SummaryItemSubject = Extract<
  PriceLineSubject,
  { readonly _tag: "Product" | "Coffee" | "Workstation" | "Monitor" | "Other" }
>;

/** One line of an itemized price. */
export type PriceLine =
  | {
      readonly _tag: "Charge";
      readonly key: string;
      readonly subject: PriceLineSubject;
      readonly amount: Money;
    }
  | {
      readonly _tag: "Reduction";
      readonly key: string;
      readonly discountId: string;
      /** The discount's name as the pricing response gives it. */
      readonly label: string;
      /** How the discount is worked out, such as 20% off. */
      readonly adjustment: CustomerDiscountAdjustment;
      /** What the discount takes off, positive. */
      readonly amount: Money;
    };

/** The itemized price: its lines and the total they add up to. */
export interface PriceBreakdown {
  readonly lines: ReadonlyArray<PriceLine>;
  /** The response's total, never summed by the app. */
  readonly total: Money;
  /** The seller's VAT status: only a VAT payer's total has a tax note. */
  readonly vatStatus: CustomerVatStatus;
}

/**
 * What a summary item's key names: `product:<product key>`, `addon:coffee`,
 * `addon:workstation`, `monitor:<option>`, anything else as itself.
 */
export const summaryItemSubject = (key: string): SummaryItemSubject => {
  const [prefix, ...rest] = key.split(":");
  const name = rest.join(":");
  if (prefix === "product") return { _tag: "Product", product: name };
  if (key === "addon:coffee") return { _tag: "Coffee" };
  if (key === "addon:workstation") return { _tag: "Workstation" };
  if (prefix === "monitor") return { _tag: "Monitor", option: name };
  return { _tag: "Other", key };
};

const totalKey = "total:final";

/**
 * An office product line's two parts, both before discounts: access, and
 * `seatsAmount` (every seat for the days booked), as the answer totals them.
 */
const officeCharges = (
  item: CustomerCheckoutSummaryItem
): ReadonlyArray<PriceLine> | undefined => {
  const {
    key,
    dayCount,
    seats,
    accessAmount,
    seatsAmount,
    dailyAccessRate,
    dailySeatRate,
  } = item;
  if (
    dayCount === undefined ||
    seats === undefined ||
    accessAmount === undefined ||
    seatsAmount === undefined
  ) {
    return undefined;
  }
  return [
    {
      _tag: "Charge",
      key: `${key}:access`,
      subject: {
        _tag: "OfficeAccess",
        dayCount,
        ...(dailyAccessRate === undefined
          ? {}
          : { dailyRate: dailyAccessRate }),
      },
      amount: accessAmount,
    },
    {
      _tag: "Charge",
      key: `${key}:seats`,
      subject: {
        _tag: "OfficeSeats",
        seats,
        dayCount,
        ...(dailySeatRate === undefined ? {} : { dailySeatRate }),
      },
      amount: seatsAmount,
    },
  ];
};

/** A summary discount as the reduction line it reads as. */
export const discountLine = (
  itemKey: string,
  { discount, amount }: CustomerCheckoutSummaryDiscount
): PriceLine => ({
  _tag: "Reduction",
  key: `${itemKey}:discount:${discount.id}`,
  discountId: discount.id,
  label: discount.label,
  adjustment: discount.adjustment,
  amount,
});

/** A meeting room's early setup, after the room's discounts: free, as priced. */
const earlySetupLines = ({
  key,
  earlySetup,
}: CustomerCheckoutSummaryItem): PriceLine[] =>
  earlySetup === undefined
    ? []
    : [
        {
          _tag: "Charge",
          key: `${key}:early-setup`,
          subject: { _tag: "EarlySetup", startsAt: earlySetup.startsAt },
          amount: earlySetup.amount,
        },
      ];

const itemLines = (item: CustomerCheckoutSummaryItem): PriceLine[] => [
  ...(officeCharges(item) ?? [
    {
      _tag: "Charge",
      key: item.key,
      subject: summaryItemSubject(item.key),
      amount: item.originalAmount ?? item.amount,
    },
  ]),
  ...(item.discounts ?? []).map((discount) => discountLine(item.key, discount)),
  ...earlySetupLines(item),
];

/**
 * The pricing response's itemized price, in its order: each line at its
 * price before discounts, followed by one reduction per discount on it, and
 * a meeting room's free early setup last, so the lines add up to the
 * response's total. The final total line is the
 * breakdown's `total`, not a line.
 */
export const priceBreakdown = (
  summary: CustomerCheckoutSummary
): PriceBreakdown => ({
  lines: summary.sections.flatMap((section) =>
    section.items.filter((item) => item.key !== totalKey).flatMap(itemLines)
  ),
  total: summary.total,
  vatStatus: summary.vatStatus,
});

/** A line's amount with its sign: a reduction is negative. */
export const priceLineAmount = (line: PriceLine): Money =>
  line._tag === "Reduction"
    ? { ...line.amount, value: -Math.abs(line.amount.value) }
    : line.amount;
