import type { CheckoutSummaryOrderItem } from "@/features/checkout/checkout-summary";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import { CheckoutSummaryLine } from "@/features/checkout/components/checkout-summary-line";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatMoney, moneyWithValue } from "@/shared/money/money";

type OfficeCheckoutSummaryItem = Extract<
  CheckoutSummaryOrderItem,
  { readonly product: { readonly kind: "office" } }
>;

/** The office's first day as order lines name it, such as "Wed, Nov 18". */
const formatOfficeOrderDate = (date: Temporal.PlainDate, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date.toZonedDateTime("UTC").epochMilliseconds);

export function OfficeCheckoutSummaryItem({
  changed,
  item,
  locale,
  startsOn,
}: {
  readonly changed?: boolean;
  readonly item: OfficeCheckoutSummaryItem;
  readonly locale: Locale;
  /** The office's first day, when the page knows the reservation. */
  readonly startsOn?: Temporal.PlainDate;
}) {
  const discountAmount = item.originalAmount
    ? moneyWithValue(item.amount.value - item.originalAmount.value, item.amount)
    : undefined;

  return (
    <>
      <CheckoutSummaryLine
        amount={item.accessAmount}
        changed={changed}
        label={[
          getWorkspaceOfficeProductTitle(locale),
          ...(startsOn ? [formatOfficeOrderDate(startsOn, locale)] : []),
          m.checkoutSummaryItemOfficeDayCount(
            { dayCount: item.dayCount },
            { locale }
          ),
        ].join(" · ")}
        locale={locale}
      />
      <CheckoutSummaryLine
        amount={item.seatsAmount}
        changed={changed}
        label={m.officePeoplePriceSeatLine(
          {
            count: item.seats,
            seatPrice: formatMoney(item.seatAmount, locale),
          },
          { locale }
        )}
        locale={locale}
      />
      {discountAmount && item.discounts ? (
        <CheckoutSummaryLine
          amount={discountAmount}
          changed={changed}
          label={m.checkoutSummaryItemOfficeDiscount({}, { locale })}
          locale={locale}
        >
          <CheckoutSummaryDiscountDetails
            discounts={item.discounts}
            locale={locale}
            productLabel={getWorkspaceOfficeProductTitle(locale)}
          />
        </CheckoutSummaryLine>
      ) : null}
    </>
  );
}
