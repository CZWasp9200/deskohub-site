import type { Money } from "@deskohub/workspace-customer-api";
import type { AppLocale } from "../../../i18n/app-locale";
import type { DateChoice } from "../../selection/booking-selection";
import type { PragueDate } from "../../selection/prague-date";
import type { BookingBarPrice } from "../booking-bar";
import type { CalendarRange } from "../month-calendar-model";
import { priceBreakdown } from "../price-breakdown";
import { describePriceLine } from "../price-line-description";
import type { PriceFixture } from "../testing/price-fixtures";

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
