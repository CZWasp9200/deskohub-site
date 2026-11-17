import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import type { Money } from "@deskohub/workspace-customer-api";
import type { AppLocale } from "./app-locale";

/** The exact decimal text of `value` minor units, e.g. 45000 at 2 → "450.00". */
export const minorUnitsText = ({
  value,
  exponent,
}: Pick<Money, "value" | "exponent">): string => {
  const digits = Math.abs(value)
    .toString()
    .padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${value < 0 ? "-" : ""}${whole}${exponent > 0 ? `.${fraction}` : ""}`;
};

/**
 * A customer API amount as the customer reads it, such as "CZK 282",
 * "CZK 258.80" or "282 Kč": whole amounts drop their minor units, others
 * show all of the currency's. The app's one money formatter.
 */
export const formatMoney = (money: Money, locale: AppLocale): string =>
  formatCurrencyAmount({
    amount: minorUnitsText(money),
    currency: money.currency,
    locale,
    fractionDigits: money.exponent,
  });

/** What a discount takes off, such as "− CZK 58" (a minus sign, then a space). */
export const formatMoneyReduction = (money: Money, locale: AppLocale): string =>
  `− ${formatMoney({ ...money, value: Math.abs(money.value) }, locale)}`;
