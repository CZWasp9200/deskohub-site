import type {
  CustomerBookingSelection,
  CustomerDiscountAdjustment,
  CustomerMonitorOption,
  Money,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { formatBasisPoints } from "../../i18n/percent-format";
import { bookingOverviewOf } from "../checkout-screen/booking-overview";
import { productLabel } from "../checkout-screen/checkout-copy";
import type { PriceLine, PriceLineSubject } from "./price-breakdown";

/** How a price line reads: its name, and what it covers in grey under it. */
export interface PriceLineDescription {
  readonly label: string;
  readonly detail?: string;
}

/** A monitor setup's name, the same in every language. */
const monitorOptionNames = {
  "2x27-qhd": "2× 27″ QHD",
  "2x32-qhd": "2× 32″ QHD",
  "2x27-4k": "2× 27″ 4K",
  "2x32-4k": "2× 32″ 4K",
} as const satisfies Record<CustomerMonitorOption, string>;

export const monitorOptionName = (option: CustomerMonitorOption): string =>
  monitorOptionNames[option];

/**
 * What the booked product covers: a cowork desk's day or overnight stay, or a meeting room's
 * hours with their times, or its whole day.
 */
const productDetail = (
  selection: CustomerBookingSelection,
  locale: AppLocale
): string | undefined => {
  const overview = bookingOverviewOf(selection, false);
  switch (overview._tag) {
    case "Cowork":
      return selection.stay === "overnight"
        ? m.booking_cowork_stay_overnight({}, { locale })
        : m.booking_price_line_days({ count: 1 }, { locale });
    case "MeetingRoom":
      return Option.match(overview.time, {
        onNone: () => undefined,
        onSome: (time) =>
          time._tag === "WholeDay"
            ? m.booking_checkout_overview_whole_day({}, { locale })
            : (selection.duration === "hour:4"
                ? m.booking_price_line_four_hours
                : m.booking_price_line_one_hour)(
                { start: time.start, end: time.end },
                { locale }
              ),
      });
    case "Office":
      return undefined;
  }
};

/**
 * A counted line's factors, each already worded, as the boards write them:
 * "6 seats × 3 days × CZK 315", the price of one unit last where the quote
 * gives it. The multiplication sign reads the same in every app locale.
 */
const countedDetail = (
  counts: ReadonlyArray<string>,
  unitPrice: Money | undefined,
  locale: AppLocale
): string =>
  [
    ...counts,
    ...(unitPrice === undefined ? [] : [formatMoney(unitPrice, locale)]),
  ].join(" × ");

const chargeDescription = (
  subject: PriceLineSubject,
  /** What the booked product covers; asked only for a product line. */
  coveredByProduct: () => string | undefined,
  locale: AppLocale,
  productName: string
): PriceLineDescription => {
  switch (subject._tag) {
    case "Product":
      return { label: productName, detail: coveredByProduct() };
    case "OfficeAccess":
      return {
        label: productName,
        detail: countedDetail(
          [m.booking_price_line_days({ count: subject.dayCount }, { locale })],
          subject.dailyRate,
          locale
        ),
      };
    case "OfficeSeats":
      return {
        label: m.booking_checkout_line_office_seats({}, { locale }),
        detail: countedDetail(
          [
            m.booking_price_line_seats({ count: subject.seats }, { locale }),
            m.booking_price_line_days({ count: subject.dayCount }, { locale }),
          ],
          subject.dailySeatRate,
          locale
        ),
      };
    case "Coffee":
      return { label: m.booking_checkout_line_coffee({}, { locale }) };
    case "Workstation":
      return {
        label: m.booking_checkout_line_workstation({}, { locale }),
        ...(subject.monitorOption !== undefined && {
          detail: monitorOptionName(subject.monitorOption),
        }),
      };
    case "EarlySetup":
      return {
        label: m.booking_price_line_early_setup({}, { locale }),
        detail: Option.match(parseInstant(subject.startsAt), {
          onNone: () => undefined,
          onSome: (startsAt) =>
            m.booking_price_line_early_setup_from(
              { time: formatInstant(startsAt, locale, "time") },
              { locale }
            ),
        }),
      };
    case "Other":
      return { label: m.booking_checkout_line_other({}, { locale }) };
  }
};

/** What a discount takes off, such as "20% off" or "CZK 50 off". */
const adjustmentDetail = (
  adjustment: CustomerDiscountAdjustment,
  locale: AppLocale
): string =>
  m.booking_price_line_discount_off(
    {
      amount:
        adjustment.kind === "percentage"
          ? formatBasisPoints(adjustment.basisPoints, locale)
          : formatMoney(adjustment.amount, locale),
    },
    { locale }
  );

/** A discount line: the pricing response's label, and what it takes off. */
const reductionDescription = (
  line: Extract<PriceLine, { readonly _tag: "Reduction" }>,
  locale: AppLocale
): PriceLineDescription => ({
  label: line.label,
  detail: adjustmentDetail(line.adjustment, locale),
});

/**
 * Names a booking's price lines, the one place that does: the product by
 * the booked selection, which is what the server priced, with what it
 * covers; add-ons by kind; a discount by the pricing response's own label,
 * with what it takes off. Counts read in the locale's plural form, "3 days".
 */
export const describePriceLine =
  (
    selection: CustomerBookingSelection,
    locale: AppLocale,
    /** The catalog's name for the product, where the screen has it. */
    productName: string = productLabel(selection, locale)
  ) =>
  (line: PriceLine): PriceLineDescription =>
    line._tag === "Reduction"
      ? reductionDescription(line, locale)
      : chargeDescription(
          line.subject,
          () => productDetail(selection, locale),
          locale,
          productName
        );

/**
 * Names an office's lines before there is a selection, such as those of
 * its from-price: access by its days, seats by seats and days, the same
 * way `describePriceLine` names them once quoted.
 */
export const describeOfficePriceLine =
  (locale: AppLocale, productName: string) =>
  (line: PriceLine): PriceLineDescription =>
    line._tag === "Reduction"
      ? reductionDescription(line, locale)
      : chargeDescription(line.subject, () => undefined, locale, productName);
