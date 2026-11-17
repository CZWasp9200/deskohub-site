import type {
  CustomerCheckoutSummary,
  CustomerCheckoutSummaryItem,
  CustomerMonitorOption,
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
  /** The monitor workstation, with the monitor setup it is configured with. */
  | {
      readonly _tag: "Workstation";
      readonly monitorOption?: CustomerMonitorOption;
    }
  | { readonly _tag: "Other"; readonly key: string };

/** The subjects a summary item names on its own. */
export type SummaryItemSubject = Extract<
  PriceLineSubject,
  { readonly _tag: "Product" | "Coffee" | "Workstation" | "Other" }
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
 * What a summary item names: `product:<product key>`, `addon:coffee`,
 * `addon:workstation` with its monitor setup, anything else as itself.
 */
export const summaryItemSubject = ({
  key,
  monitorOption,
}: Pick<
  CustomerCheckoutSummaryItem,
  "key" | "monitorOption"
>): SummaryItemSubject => {
  const [prefix, ...rest] = key.split(":");
  if (prefix === "product") return { _tag: "Product", product: rest.join(":") };
  if (key === "addon:coffee") return { _tag: "Coffee" };
  if (key === "addon:workstation") {
    return monitorOption === undefined
      ? { _tag: "Workstation" }
      : { _tag: "Workstation", monitorOption };
  }
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
  const { key, dayCount, seats, accessAmount, seatsAmount } = item;
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
      subject: { _tag: "OfficeAccess", dayCount },
      amount: accessAmount,
    },
    {
      _tag: "Charge",
      key: `${key}:seats`,
      subject: { _tag: "OfficeSeats", seats, dayCount },
      amount: seatsAmount,
    },
  ];
};

const itemLines = (item: CustomerCheckoutSummaryItem): PriceLine[] => [
  ...(officeCharges(item) ?? [
    {
      _tag: "Charge",
      key: item.key,
      subject: summaryItemSubject(item),
      amount: item.originalAmount ?? item.amount,
    },
  ]),
  ...(item.discounts ?? []).map(
    ({ discount, amount }): PriceLine => ({
      _tag: "Reduction",
      key: `${item.key}:discount:${discount.id}`,
      discountId: discount.id,
      label: discount.label,
      amount,
    })
  ),
];

/**
 * The pricing response's itemized price, in its order: each line at its
 * price before discounts, followed by one reduction per discount on it, so
 * the lines add up to the response's total. The final total line is the
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
