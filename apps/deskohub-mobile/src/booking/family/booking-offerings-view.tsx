import type { CustomerBookingOfferings } from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";
import { useAppLocale } from "../../i18n/locale-context";
import { bookingOfferingsAtom } from "../data/booking-queries";
import { bookingReadOf } from "./booking-family-view";
import { BookingReadView } from "./booking-read-view";

/**
 * The booking catalog in the app's language, read only once the screen
 * renders it, so an account the gate turns away spends no catalog read.
 */
export function BookingOfferingsView({
  loading,
  failedTitle,
  children,
}: {
  /** The first load's placeholder in the screen's layout; a spinner without. */
  readonly loading?: ReactNode;
  /** What a first load that failed names as not loaded, over its cause. */
  readonly failedTitle?: string;
  readonly children: (catalog: CustomerBookingOfferings) => ReactNode;
}) {
  const locale = useAppLocale();
  const offerings = useAtomValue(bookingOfferingsAtom(locale));
  const refresh = useAtomRefresh(bookingOfferingsAtom(locale));
  return (
    <BookingReadView
      read={bookingReadOf(offerings)}
      onRetry={refresh}
      loading={loading}
      failedTitle={failedTitle}
    >
      {children}
    </BookingReadView>
  );
}
