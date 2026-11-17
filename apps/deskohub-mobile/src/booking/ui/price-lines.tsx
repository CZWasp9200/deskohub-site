import type {
  CustomerVatStatus,
  Money,
} from "@deskohub/workspace-customer-api";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { formatMoney, formatMoneyReduction } from "../../i18n/money-format";
import { Text } from "../../ui/text";
import { color, space, typeScale } from "../../ui/tokens";
import type { PriceBreakdown, PriceLine } from "./price-breakdown";
import type { PriceLineDescription } from "./price-line-description";

/** Where the lines stand: the opened booking bar, or the review's price card. */
export type PriceLinesVariant = "bar" | "card";

/** The card's total row. */
export interface PriceLinesTotal {
  readonly label: string;
  /** The total before a discount, struck through above the total. */
  readonly was?: Money;
  /**
   * The one tax note under the total's label, shown only while the
   * breakdown's seller is a VAT payer.
   */
  readonly taxNote?: string;
}

/** A line's amount as it reads: a discount as "− CZK 58", nothing to pay as "Free". */
const priceLineAmountText = (line: PriceLine, locale: AppLocale): string => {
  if (line._tag === "Reduction") {
    return formatMoneyReduction(line.amount, locale);
  }
  return line.amount.value === 0
    ? m.booking_price_free({}, { locale })
    : formatMoney(line.amount, locale);
};

/** The original price, read aloud for a struck-through amount. */
export const wasPriceLabel = (was: Money, locale: AppLocale) =>
  m.booking_checkout_summary_original_price(
    { amount: formatMoney(was, locale) },
    { locale }
  );

/**
 * A booking's itemized price: each line's name with what it covers, and its
 * amount on the right; discounts in green. `bar` is the opened booking
 * bar's list; `card` is the review's price card, ending in the total row
 * when `total` is given. Each line reads as one item.
 */
export function PriceLines({
  breakdown,
  describeLine,
  locale,
  variant,
  total,
}: {
  readonly breakdown: PriceBreakdown;
  readonly describeLine: (line: PriceLine) => PriceLineDescription;
  readonly locale: AppLocale;
  readonly variant: PriceLinesVariant;
  readonly total?: PriceLinesTotal;
}) {
  const look = variant === "bar" ? barStyles : cardStyles;
  return (
    <View style={look.list}>
      {breakdown.lines.map((line) => {
        const { label, detail } = describeLine(line);
        const amount = priceLineAmountText(line, locale);
        const reduction = line._tag === "Reduction";
        return (
          <View
            key={line.key}
            accessible
            accessibilityLabel={[label, detail, amount]
              .filter((part) => part !== undefined && part !== "")
              .join(", ")}
            style={look.row}
          >
            <View style={look.name}>
              <Text style={[look.label, reduction && styles.reduction]}>
                {label}
              </Text>
              {detail !== undefined && detail !== "" && (
                <Text style={[look.detail, reduction && styles.reduction]}>
                  {detail}
                </Text>
              )}
            </View>
            <Text
              numeric
              style={[
                look.amount,
                reduction && styles.reduction,
                reduction && look.reductionAmount,
              ]}
            >
              {amount}
            </Text>
          </View>
        );
      })}
      {variant === "card" && total !== undefined && (
        <TotalRow
          total={total}
          amount={breakdown.total}
          vatStatus={breakdown.vatStatus}
          locale={locale}
        />
      )}
    </View>
  );
}

function TotalRow({
  total,
  amount,
  vatStatus,
  locale,
}: {
  readonly total: PriceLinesTotal;
  readonly amount: Money;
  readonly vatStatus: CustomerVatStatus;
  readonly locale: AppLocale;
}) {
  const { label, was } = total;
  const taxNote = vatStatus === "vat-payer" ? total.taxNote : undefined;
  return (
    <View style={totalStyles.row}>
      <View style={cardStyles.name}>
        <Text style={totalStyles.label}>{label}</Text>
        {taxNote !== undefined && taxNote !== "" && (
          <Text style={cardStyles.detail}>{taxNote}</Text>
        )}
      </View>
      <View style={totalStyles.amounts}>
        {was !== undefined && (
          <Text
            numeric
            aria-label={wasPriceLabel(was, locale)}
            style={totalStyles.was}
          >
            {formatMoney(was, locale)}
          </Text>
        )}
        <Text numeric style={totalStyles.amount}>
          {formatMoney(amount, locale)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reduction: { color: color.positiveInk },
});

// `.bk-items`: the opened bar's list, closed by a divider above the summary.
const barStyles = StyleSheet.create({
  list: {
    borderBottomColor: color.divider,
    borderBottomWidth: 1,
    paddingBottom: 10,
    paddingTop: space.xs,
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.lg,
    justifyContent: "space-between",
    paddingVertical: space.sm,
  },
  name: { flexShrink: 1, minWidth: 0 },
  label: { ...typeScale.subhead, color: color.navy },
  detail: { ...typeScale.hint, color: color.ink2 },
  amount: { ...typeScale.subhead, color: color.navy, flexShrink: 0 },
  reductionAmount: {},
});

// `.bk-price` / `.bk-li`: the review card's rows.
// A row too narrow for its name and amount, as at large font sizes, puts
// the amount under the name on the right instead of breaking words.
const cardStyles = StyleSheet.create({
  list: { gap: 10 },
  row: {
    alignItems: "baseline",
    columnGap: space.md,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  name: { flexShrink: 0, maxWidth: "100%" },
  label: { ...typeScale.lead, color: color.navy },
  detail: { ...typeScale.hint, color: color.ink2 },
  amount: {
    ...typeScale.lead,
    color: color.navy,
    flexShrink: 0,
    marginLeft: "auto",
    textAlign: "right",
  },
  reductionAmount: { ...typeScale.subhead, lineHeight: 22 },
});

// `.bk-li.tot`: the total under a divider, the struck earlier total above it.
const totalStyles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderTopColor: color.divider,
    borderTopWidth: 1,
    columnGap: space.md,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingTop: space.md,
  },
  label: { ...typeScale.headline, color: color.navy },
  amounts: { alignItems: "flex-end", flexShrink: 0, marginLeft: "auto" },
  was: {
    ...typeScale.hint,
    color: color.ink2,
    lineHeight: 16,
    textDecorationLine: "line-through",
  },
  amount: {
    ...typeScale.titleLarge,
    color: color.navy,
    fontSize: 24,
    lineHeight: 28,
  },
});
