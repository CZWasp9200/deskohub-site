import type { Money } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { AppLocale } from "../../../i18n/app-locale";
import { officeFromPrice } from "../../family/office-booking-model";
import type { DateChoice } from "../../selection/booking-selection";
import type { PragueDate } from "../../selection/prague-date";
import type { BookingBarPrice } from "../booking-bar";
import type { CalendarRange } from "../month-calendar-model";
import { priceBreakdown } from "../price-breakdown";
import {
  describeOfficePriceLine,
  describePriceLine,
} from "../price-line-description";
import { officeOnSale, type PriceFixture } from "../testing/price-fixtures";

// Synthetic fixture dates, as the boards draw them: November 2026 seen on
// the 10th, with the 20th full for cowork and the 14th and 15th for the
// office. Shared by the gallery sections and the board frames.
export const galleryToday: PragueDate = "2026-11-10";
export const coworkDates: DateChoice = {
  earliest: galleryToday,
  latest: "2027-01-31",
  unavailable: new Set(["2026-11-20"]),
};
export const officeDates: DateChoice = {
  ...coworkDates,
  unavailable: new Set(["2026-11-14", "2026-11-15"]),
};
export const officeRange: CalendarRange = {
  start: "2026-11-23",
  end: "2026-11-25",
};

/** A fixture's quote as the booking bar's price, struck `was` optional. */
export const quotedPrice = (
  { selection, summary }: PriceFixture,
  locale: AppLocale,
  was?: Money
): BookingBarPrice => ({
  kind: "quoted",
  breakdown: priceBreakdown(summary),
  describeLine: describePriceLine(selection, locale),
  was,
});

/** The office's from-price during a sale, opened to its lines. */
export const officeSaleFromPrice = (
  locale: AppLocale,
  sample: (text: string) => string
): BookingBarPrice => ({
  kind: "from",
  amount: officeOnSale.advertisedPrice.price,
  unit: sample("per day, 1 seat"),
  ...Option.match(officeFromPrice(officeOnSale), {
    onNone: () => ({}),
    onSome: (breakdown) => ({
      itemized: {
        breakdown,
        describeLine: describeOfficePriceLine(locale, officeOnSale.name),
      },
    }),
  }),
});
