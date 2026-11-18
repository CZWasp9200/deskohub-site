import type {
  CustomerBookingQuote,
  CustomerBookingSelection,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { bookingOverviewOf } from "../checkout-screen/booking-overview";
import { productLabel } from "../checkout-screen/checkout-copy";
import {
  type CoworkOvernightStay,
  openSpaceClosingTime,
} from "../selection/cowork-selection";
import type { BookingBarSummary } from "./booking-bar";
import { formatPragueTime, formatShortPragueDate } from "./prague-date-format";
import { priceBreakdown } from "./price-breakdown";
import { describePriceLine, monitorOptionName } from "./price-line-description";

/** What the catalog says about the booked product, where the screen has it. */
export interface BookingSummaryProduct {
  /** The catalog's name for the product. */
  readonly name?: string;
  /** A Reserved Desk's overnight stay times, for an overnight selection. */
  readonly overnightStay?: CoworkOvernightStay;
}

/** What the booking bar says about a selection: when, and what. */
export interface BookingSummaryText {
  /**
   * When: "Thu 26 Nov, until 17:00", "Mon 23 Nov – Wed 25 Nov",
   * "Mon 17 Nov 12:00 → Tue 18 Nov 12:00".
   */
  readonly title: string;
  /** What: the product and its extras, "Open Space · coffee". */
  readonly detail: string;
}

/**
 * The booking bar's summary of a complete selection, as the booking boards
 * word it: the date and the hours it covers, then the product and what it
 * comes with. One composer for every booking step that shows the bar.
 */
export const bookingSummaryOf = (
  selection: CustomerBookingSelection,
  locale: AppLocale,
  {
    name: product = productLabel(selection, locale),
    overnightStay,
  }: BookingSummaryProduct = {}
): BookingSummaryText => {
  const { title, extras } = bookingSummaryParts(
    selection,
    locale,
    overnightStay
  );
  return { title, detail: [product, ...extras].join(" · ") };
};

/**
 * A selection's summary in parts: when, and what the product comes with
 * ("coffee", "4 hours", "6 people"), for the bar's one detail line
 * or the review's booking card.
 */
export interface BookingSummaryParts {
  readonly title: string;
  readonly extras: ReadonlyArray<string>;
}

export const bookingSummaryParts = (
  selection: CustomerBookingSelection,
  locale: AppLocale,
  /** A Reserved Desk's overnight stay times, for an overnight selection. */
  overnightStay?: CoworkOvernightStay
): BookingSummaryParts => {
  const extrasOf = (...extras: ReadonlyArray<string | undefined>) =>
    extras.filter((extra): extra is string => extra !== undefined);
  const overview = bookingOverviewOf(selection, false, overnightStay);
  switch (overview._tag) {
    case "Cowork": {
      const date = formatShortPragueDate(overview.date, locale);
      if (selection.tier === "reserved-desk") {
        return {
          title: Option.match(overview.overnight, {
            onNone: () =>
              m.booking_summary_reserved_desk_day({ date }, { locale }),
            onSome: ({ start, end, endDate }) =>
              m.booking_summary_reserved_desk_overnight(
                {
                  arrivalDate: date,
                  arrivalTime: formatPragueTime(start, locale),
                  departureDate: formatShortPragueDate(endDate, locale),
                  departureTime: formatPragueTime(end, locale),
                },
                { locale }
              ),
          }),
          extras: extrasOf(
            selection.monitorOption === undefined
              ? undefined
              : monitorOptionName(selection.monitorOption)
          ),
        };
      }
      return {
        title: m.booking_summary_open_space_day(
          { date, time: formatPragueTime(openSpaceClosingTime, locale) },
          { locale }
        ),
        extras: extrasOf(
          selection.coffee === true
            ? m.booking_summary_coffee({}, { locale })
            : undefined
        ),
      };
    }
    case "MeetingRoom": {
      const date = formatShortPragueDate(overview.date, locale);
      return Option.match(overview.time, {
        onNone: () => ({ title: date, extras: extrasOf() }),
        onSome: (time) => {
          if (time._tag === "WholeDay") {
            return {
              title: m.booking_summary_whole_day({ date }, { locale }),
              extras: extrasOf(),
            };
          }
          return {
            title: m.booking_summary_hours(
              {
                date,
                start: formatPragueTime(time.start, locale),
                end: formatPragueTime(time.end, locale),
              },
              { locale }
            ),
            extras: extrasOf(
              selection.duration === "hour:4"
                ? m.booking_summary_four_hours({}, { locale })
                : m.booking_summary_one_hour({}, { locale })
            ),
          };
        },
      });
    }
    case "Office": {
      const first = formatShortPragueDate(overview.firstDate, locale);
      return {
        title:
          overview.lastDate === overview.firstDate
            ? first
            : m.booking_summary_range(
                {
                  start: first,
                  end: formatShortPragueDate(overview.lastDate, locale),
                },
                { locale }
              ),
        extras: extrasOf(
          m.booking_office_people_count({ count: overview.seats }, { locale })
        ),
      };
    }
  }
};

/**
 * The booking bar's summary of a quoted selection: what and when, and the
 * quoted total with its lines, struck above by the regular price while a
 * discount lowers it.
 */
export const quotedBarSummary = (
  selection: CustomerBookingSelection,
  {
    summary,
    regularPrice,
  }: Pick<CustomerBookingQuote, "summary" | "regularPrice">,
  locale: AppLocale,
  product: BookingSummaryProduct = {}
): BookingBarSummary => ({
  ...bookingSummaryOf(selection, locale, product),
  price: {
    kind: "quoted",
    breakdown: priceBreakdown(summary),
    describeLine: describePriceLine(selection, locale, product.name),
    ...(regularPrice.value > summary.total.value && { was: regularPrice }),
  },
});
