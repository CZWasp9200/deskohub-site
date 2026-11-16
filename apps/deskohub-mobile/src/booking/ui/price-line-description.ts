import type {
  CustomerBookingSelection,
  CustomerMonitorOption,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
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

export const monitorOptionName = (option: string): string =>
  option in monitorOptionNames
    ? monitorOptionNames[option as CustomerMonitorOption]
    : option;

/**
 * What the booked product covers: a cowork desk's day, or a meeting room's
 * hours with their times, or its whole day.
 */
const productDetail = (
  selection: CustomerBookingSelection,
  locale: AppLocale
): string | undefined => {
  const overview = bookingOverviewOf(selection, false);
  switch (overview._tag) {
    case "Cowork":
      return m.booking_price_line_one_day({}, { locale });
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

const chargeDescription = (
  subject: PriceLineSubject,
  selection: CustomerBookingSelection,
  locale: AppLocale
): PriceLineDescription => {
  switch (subject._tag) {
    case "Product":
      return {
        label: productLabel(selection, locale),
        detail: productDetail(selection, locale),
      };
    case "OfficeAccess":
      return {
        label: productLabel(selection, locale),
        detail: m.booking_checkout_summary_office_days(
          { count: subject.dayCount },
          { locale }
        ),
      };
    case "OfficeSeats":
      return {
        label: m.booking_checkout_summary_office_seats(
          { count: subject.seats },
          { locale }
        ),
        detail: m.booking_checkout_summary_office_days(
          { count: subject.dayCount },
          { locale }
        ),
      };
    case "Coffee":
      return { label: m.booking_checkout_line_coffee({}, { locale }) };
    case "Workstation":
      return { label: m.booking_checkout_line_workstation({}, { locale }) };
    case "Monitor":
      return {
        label: m.booking_price_line_monitor_setup({}, { locale }),
        detail: monitorOptionName(subject.option),
      };
    case "Other":
      return { label: m.booking_checkout_line_other({}, { locale }) };
  }
};

/**
 * Names a booking's price lines, the one place that does: the product by
 * the booked selection, which is what the server priced, with what it
 * covers; add-ons by kind; a discount by the pricing response's own label.
 * Counts read as "Days: 3", never as a plural form: the app's runtime has
 * no plural rules.
 */
export const describePriceLine =
  (selection: CustomerBookingSelection, locale: AppLocale) =>
  (line: PriceLine): PriceLineDescription =>
    line._tag === "Reduction"
      ? { label: line.label }
      : chargeDescription(line.subject, selection, locale);
