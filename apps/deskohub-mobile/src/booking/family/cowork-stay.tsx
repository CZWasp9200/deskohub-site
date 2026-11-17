import type {
  CustomerBookingSelection,
  CustomerCoworkStay,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import Moon from "lucide-react-native/icons/moon";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Switch } from "../../ui/switch";
import type { CoworkOvernightStay } from "../selection/cowork-selection";
import { BookingSectionHeading } from "../ui/booking-section-heading";
import { bookingSummaryParts } from "../ui/booking-summary";
import { OvernightStayTimes } from "../ui/overnight-stay-times";

/**
 * The cowork screen's Date heading. While the chosen tier offers an
 * overnight stay (only the Reserved Desk does), its "Overnight" switch sits
 * on the right: on books the date as an overnight stay, off as a day.
 */
export function CoworkDateHeading({
  locale,
  overnightStay,
  stay,
  onStayChange,
}: {
  readonly locale: AppLocale;
  readonly overnightStay: CoworkOvernightStay | undefined;
  readonly stay: CustomerCoworkStay;
  readonly onStayChange: (stay: CustomerCoworkStay) => void;
}) {
  const overnight = m.booking_cowork_stay_overnight({}, { locale });
  return (
    <BookingSectionHeading
      title={m.booking_date_heading({}, { locale })}
      control={
        overnightStay === undefined ? undefined : (
          <Switch
            label={overnight}
            accessibilityLabel={overnight}
            icon={Moon}
            value={stay === "overnight"}
            onValueChange={(on) => onStayChange(on ? "overnight" : "day")}
          />
        )
      }
    />
  );
}

/**
 * When an overnight selection starts and ends, under the calendar, worded
 * as the booking summaries word it; nothing for a day or before a date.
 */
export function CoworkStayTimes({
  locale,
  overnightStay,
  selection,
}: {
  readonly locale: AppLocale;
  readonly overnightStay: CoworkOvernightStay | undefined;
  readonly selection: Option.Option<CustomerBookingSelection>;
}) {
  if (overnightStay === undefined || Option.isNone(selection)) return null;
  if (selection.value.family !== "cowork") return null;
  if (selection.value.stay !== "overnight") return null;
  return (
    <OvernightStayTimes
      times={bookingSummaryParts(selection.value, locale, overnightStay).title}
    />
  );
}
