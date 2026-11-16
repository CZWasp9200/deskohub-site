import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { bookingOverviewOf } from "../checkout-screen/booking-overview";
import { productLabel } from "../checkout-screen/checkout-copy";
import { openSpaceClosingTime } from "../selection/cowork-selection";
import type { PragueDate } from "../selection/prague-date";
import { formatPragueDate, formatPragueTime } from "./prague-date-format";
import { monitorOptionName } from "./price-line-description";

/** What the booking bar says about a selection: when, and what. */
export interface BookingSummaryText {
  /** When: "Thu 26 Nov, until 17:00", "Mon 23 Nov – Wed 25 Nov". */
  readonly title: string;
  /** What: the product and its extras, "Open Space · coffee". */
  readonly detail: string;
}

const shortDate = (date: PragueDate, locale: AppLocale) =>
  formatPragueDate(date, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/**
 * The booking bar's summary of a complete selection, as the booking boards
 * word it: the date and the hours it covers, then the product and what it
 * comes with. One composer for every booking step that shows the bar.
 */
export const bookingSummaryOf = (
  selection: CustomerBookingSelection,
  locale: AppLocale
): BookingSummaryText => {
  const product = productLabel(selection, locale);
  const detail = (...extras: ReadonlyArray<string | undefined>) =>
    [product, ...extras.filter((extra) => extra !== undefined)].join(" · ");
  const overview = bookingOverviewOf(selection, false);
  switch (overview._tag) {
    case "Cowork": {
      const date = shortDate(overview.date, locale);
      if (selection.tier === "reserved-desk") {
        return {
          title: m.booking_summary_reserved_desk_day({ date }, { locale }),
          detail: detail(
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
        detail: detail(
          selection.coffee === true
            ? m.booking_summary_coffee({}, { locale })
            : undefined
        ),
      };
    }
    case "MeetingRoom": {
      const date = shortDate(overview.date, locale);
      return Option.match(overview.time, {
        onNone: () => ({ title: date, detail: detail() }),
        onSome: (time) => {
          if (time._tag === "WholeDay") {
            return {
              title: m.booking_summary_whole_day({ date }, { locale }),
              detail: detail(),
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
            detail: detail(
              selection.duration === "hour:4"
                ? m.booking_summary_four_hours({}, { locale })
                : m.booking_summary_one_hour({}, { locale })
            ),
          };
        },
      });
    }
    case "Office": {
      const first = shortDate(overview.firstDate, locale);
      return {
        title:
          overview.lastDate === overview.firstDate
            ? first
            : m.booking_summary_range(
                { start: first, end: shortDate(overview.lastDate, locale) },
                { locale }
              ),
        detail: detail(
          m.booking_checkout_summary_office_seats(
            { count: overview.seats },
            { locale }
          )
        ),
      };
    }
  }
};
