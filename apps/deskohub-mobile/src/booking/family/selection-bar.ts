import type {
  CustomerBookingQuote,
  CustomerBookingSelection,
  Money,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import type { CoworkOvernightStay } from "../selection/cowork-selection";
import type { BookingBarSummary } from "../ui/booking-bar";
import { bookingSummaryOf, quotedBarSummary } from "../ui/booking-summary";
import {
  type BookingRead,
  isRetryableBookingQueryError,
} from "./booking-family-view";

/** What a selection screen's booking bar shows and does. */
export interface SelectionBar {
  readonly summary: BookingBarSummary;
  /**
   * `continue` opens checkout once it isn't `disabled`; `retry` asks for the
   * price again after the quote failed in a way retrying can help.
   */
  readonly action: "continue" | "retry";
  readonly disabled: boolean;
  /** Why Continue is off, under it. */
  readonly reason?: string;
}

/**
 * The booking bar of a selection screen (Choose step): the product's
 * from-price and why Continue is off until the selection is complete; then
 * what and when with the quoted total, "Updating price…" while it is
 * quoted, and Try again when the quote failed in a way retrying can help.
 */
export const selectionBar = ({
  from,
  selection,
  quote,
  blocked,
  canContinue,
  locale,
}: {
  /**
   * Before the selection is complete: the product's name and price. The
   * name is the catalog's, and names the product in the summaries after.
   */
  readonly from: {
    readonly title: string;
    readonly amount: Money;
    /** Such as "per day". */
    readonly unit: string;
    /**
     * A Reserved Desk's overnight stay times, which an overnight selection's
     * summary shows.
     */
    readonly overnightStay?: CoworkOvernightStay;
  };
  /** None until the selection is complete. */
  readonly selection: Option.Option<CustomerBookingSelection>;
  /** None while there is nothing to quote. */
  readonly quote: Option.Option<BookingRead<CustomerBookingQuote>>;
  /** Why the selection can't continue, worded; none when nothing blocks it. */
  readonly blocked: Option.Option<string>;
  readonly canContinue: boolean;
  readonly locale: AppLocale;
}): SelectionBar => {
  const reason = Option.getOrUndefined(blocked);
  if (Option.isNone(selection)) {
    return {
      summary: {
        title: from.title,
        price: { kind: "from", amount: from.amount, unit: from.unit },
      },
      action: "continue",
      disabled: true,
      ...(reason === undefined ? {} : { reason }),
    };
  }
  const chosen = selection.value;
  const product = {
    name: from.title,
    ...(from.overnightStay === undefined
      ? {}
      : { overnightStay: from.overnightStay }),
  };
  const read = Option.getOrUndefined(quote);
  const unpriced = (price: BookingBarSummary["price"]): BookingBarSummary => ({
    ...bookingSummaryOf(chosen, locale, product),
    price,
  });
  if (read?.kind === "failed") {
    const retry = isRetryableBookingQueryError(read.error);
    return {
      summary: unpriced({ kind: read.retrying ? "updating" : "none" }),
      action: retry ? "retry" : "continue",
      disabled: retry ? read.retrying : true,
      ...(retry || reason === undefined ? {} : { reason }),
    };
  }
  return {
    summary:
      read?.kind === "loaded" && !read.refreshing
        ? quotedBarSummary(chosen, read.value, locale, product)
        : unpriced({ kind: read === undefined ? "none" : "updating" }),
    action: "continue",
    disabled: !canContinue,
    ...(reason === undefined ? {} : { reason }),
  };
};
