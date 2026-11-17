import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import type { CheckoutRetryKind } from "../checkout/booking-problem";

/** What went wrong that the customer can retry, as one sentence. */
export const retryMessage = (kind: CheckoutRetryKind, locale: AppLocale) =>
  ({
    service_unavailable: () =>
      m.booking_checkout_retry_service_unavailable({}, { locale }),
    connection: () => m.booking_checkout_retry_connection({}, { locale }),
    rate_limited: () => m.booking_checkout_retry_rate_limited({}, { locale }),
    session_required: () =>
      m.booking_checkout_retry_session_required({}, { locale }),
    payment_browser: () =>
      m.booking_checkout_retry_payment_browser({}, { locale }),
    unexpected: () => m.booking_checkout_retry_unexpected({}, { locale }),
  })[kind]();

/** The booked product's name, as the site's summary names it. */
export const productLabel = (
  selection: CustomerBookingSelection,
  locale: AppLocale
) => {
  switch (selection.family) {
    case "cowork":
      return selection.tier === "reserved-desk"
        ? m.booking_checkout_line_reserved_desk({}, { locale })
        : m.booking_checkout_line_open_space({}, { locale });
    case "meeting-room":
      return m.booking_checkout_line_meeting_room({}, { locale });
    case "office":
      return m.booking_checkout_line_office({}, { locale });
  }
};
