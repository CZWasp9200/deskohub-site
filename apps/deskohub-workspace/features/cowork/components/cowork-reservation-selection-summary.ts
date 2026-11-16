import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import type {
  WorkspaceCoworkProductTier,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import {
  type CoworkStay,
  isOvernightCoworkStay,
} from "@/features/reservation/cowork-stay";
import { formatReservationDisplayPlainDate } from "@/features/reservation/reservation-date";
import { formatCoworkOvernightStay } from "./cowork-stay-display";

/** The cowork selection as the contact-details step summarizes it. */
export const getCoworkReservationSelectionSummary = (
  selection: {
    readonly entryTier: WorkspaceCoworkProductTier;
    readonly date: string;
    /** An overnight stay shows its exact start and end beside the date. */
    readonly stay?: CoworkStay;
    readonly coffee?: boolean;
    /** Empty while no workstation is picked. */
    readonly monitorOption?: WorkspaceProductMonitorOption | "";
  },
  locale: Locale
): CheckoutStatusSummaryPresentation => ({
  reservationTitle: getWorkspaceProductTierTitle(selection.entryTier, locale),
  rows: [
    ...(selection.date
      ? [
          {
            label: m.checkoutStatusSummaryDateLabel({}, { locale }),
            value: isOvernightCoworkStay(selection.entryTier, selection.stay)
              ? formatCoworkOvernightStay(selection.date, locale)
              : formatReservationDisplayPlainDate(
                  Temporal.PlainDate.from(selection.date),
                  locale
                ),
          },
        ]
      : []),
    ...(selection.coffee
      ? [
          {
            label: m.checkoutStatusSummaryCoffeeLabel({}, { locale }),
            value: m.checkoutStatusYes({}, { locale }),
          },
        ]
      : []),
    ...(selection.monitorOption
      ? [
          {
            label: m.checkoutStatusSummaryMonitorLabel({}, { locale }),
            value: getWorkspaceProductMonitorTitle(
              selection.monitorOption,
              locale
            ),
          },
        ]
      : []),
  ],
});
