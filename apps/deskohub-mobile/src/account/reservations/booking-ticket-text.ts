import type { CustomerReservationStatus } from "@deskohub/workspace-customer-api";
import { DateTime, Option } from "effect";
import Check from "lucide-react-native/icons/check";
import Hourglass from "lucide-react-native/icons/hourglass";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import X from "lucide-react-native/icons/x";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant, workspaceTimeZone } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import type {
  StepState,
  TicketBadge,
  TicketLead,
  TicketReasonTone,
} from "./booking-ticket";
import type {
  TicketBadgeKind,
  TicketPriceNote,
  TicketReason,
  TicketStep,
  TicketStepName,
} from "./booking-ticket-model";
import { type BookingCountdown, formatDayCount } from "./booking-time";

/** The status badge of a booking ticket. */
export const ticketBadge = (
  kind: TicketBadgeKind,
  locale: AppLocale
): TicketBadge =>
  ({
    pending: () => ({
      label: m.reservationStatusPending({}, { locale }),
      tone: "warning" as const,
      icon: Hourglass,
    }),
    confirmed: () => ({
      label: m.reservationStatusConfirmed({}, { locale }),
      tone: "positive" as const,
      icon: Check,
    }),
    attention: () => ({
      label: m.reservationStatusAttention({}, { locale }),
      tone: "warning" as const,
      icon: TriangleAlert,
    }),
    cancelled: () => ({
      label: m.reservationStatusCancelled({}, { locale }),
      tone: "neutral" as const,
    }),
    "not-booked": () => ({
      label: m.reservations_badge_not_booked({}, { locale }),
      tone: "neutral" as const,
    }),
    withdrawn: () => ({
      label: m.reservationStatusCancelled({}, { locale }),
      tone: "neutral" as const,
      icon: X,
    }),
  })[kind]();

/** A history reservation's badge: its status as the account page names it. */
export const historyBadgeKind = (
  status: CustomerReservationStatus
): TicketBadgeKind =>
  (
    ({
      confirmed: "confirmed",
      pending: "pending",
      "requires-attention": "attention",
      cancelled: "not-booked",
    }) as const
  )[status];

/** Red only for a failure; neutral when nothing went wrong on their side. */
const reasonTone = {
  "payment-failed": "danger",
  "time-ran-out": "neutral",
  cancelled: "neutral",
  refund: "warning",
  "email-late": "warning",
} as const satisfies Record<TicketReason, TicketReasonTone>;

const reasonText = (reason: TicketReason, locale: AppLocale) =>
  ({
    "payment-failed": m.reservations_reason_payment_failed,
    "time-ran-out": m.reservations_reason_time_ran_out,
    cancelled: m.reservationStatusCancelled,
    refund: m.reservations_reason_refund,
    "email-late": m.reservations_reason_email_late,
  })[reason]({}, { locale });

export const countdownText = (
  countdown: BookingCountdown,
  locale: AppLocale
): string => {
  switch (countdown.kind) {
    case "open-now":
      return m.reservations_countdown_open_now({}, { locale });
    case "today":
      return m.reservations_countdown_today({}, { locale });
    case "tomorrow":
      return m.reservations_countdown_tomorrow({}, { locale });
    case "days":
      return m.reservations_countdown_days(
        { days: formatDayCount(countdown.days, locale) },
        { locale }
      );
  }
};

/** The header's lead: the reason when there is one, else the countdown. */
export const ticketLead = (
  reason: Option.Option<TicketReason>,
  countdown: Option.Option<BookingCountdown>,
  locale: AppLocale
): TicketLead | undefined =>
  Option.match(reason, {
    onSome: (reason): TicketLead => ({
      kind: "reason",
      text: reasonText(reason, locale),
      tone: reasonTone[reason],
    }),
    onNone: () =>
      Option.getOrUndefined(
        Option.map(
          countdown,
          (countdown): TicketLead => ({
            kind: "countdown",
            text: countdownText(countdown, locale),
          })
        )
      ),
  });

const stepTitle = ({ name, state }: TicketStep, locale: AppLocale): string =>
  ({
    // While payment is awaited the step says so; once it moved on, it is
    // just the payment.
    payment: () =>
      state === "running"
        ? m.reservations_step_awaiting_payment({}, { locale })
        : m.reservations_step_payment({}, { locale }),
    confirm: () => m.reservations_step_confirm({}, { locale }),
    pin: () => m.reservations_step_pin({}, { locale }),
    "manual-check": () => m.reservations_step_manual_check({}, { locale }),
    "booking-or-refund": () =>
      m.reservations_step_booking_or_refund({}, { locale }),
  })[name]();

const stepExplanation = (name: TicketStepName, locale: AppLocale) =>
  ({
    payment: () => m.reservations_step_payment_unconfirmed({}, { locale }),
    confirm: () => m.reservations_step_confirm_delayed({}, { locale }),
    pin: () => undefined,
    "manual-check": () => m.reservations_step_manual_check_body({}, { locale }),
    "booking-or-refund": () => undefined,
  })[name]();

const stepStates = {
  done: "done",
  running: "running",
  todo: "todo",
  warning: "warning",
} as const satisfies Record<TicketStep["state"], StepState>;

/** The steps as the ticket draws them. */
export const ticketSteps = (
  steps: ReadonlyArray<TicketStep>,
  locale: AppLocale
) =>
  steps.map((step) => ({
    key: step.name,
    state: stepStates[step.state],
    title: stepTitle(step, locale),
    description: step.explained
      ? stepExplanation(step.name, locale)
      : undefined,
  }));

/** The price line: the total, and what happened to the money. */
export const priceText = (
  price: string,
  note: TicketPriceNote,
  locale: AppLocale
): string =>
  ({
    none: () => price,
    paid: () => m.reservations_price_paid({ price }, { locale }),
    "not-charged": () =>
      m.reservations_price_not_charged({ price }, { locale }),
    "being-refunded": () =>
      m.reservations_price_refunding({ price }, { locale }),
  })[note]();

const pragueDay = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: workspaceTimeZone,
});
const dayOf = (instant: DateTime.DateTime) =>
  pragueDay.format(DateTime.toEpochMillis(instant));
const isMidnight = (instant: DateTime.DateTime) =>
  dayOf(instant) !== dayOf(DateTime.subtract(instant, { milliseconds: 1 }));

/** A Prague day as a short date, such as "Thu 26 Nov". */
export const shortDate = (instant: DateTime.DateTime, locale: AppLocale) =>
  new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: workspaceTimeZone,
  }).format(DateTime.toEpochMillis(instant));

/** A Prague day without its weekday, which the row's tile already shows. */
const dayMonth = (instant: DateTime.DateTime, locale: AppLocale) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: workspaceTimeZone,
  }).format(DateTime.toEpochMillis(instant));

/** A whole-day booking's first and last dates when it spans several days. */
export const bookingDateRange = (
  start: DateTime.DateTime,
  end: DateTime.DateTime,
  locale: AppLocale
): string | undefined => {
  if (
    !isMidnight(start) ||
    !isMidnight(end) ||
    !DateTime.isGreaterThan(end, start)
  )
    return undefined;
  const last = DateTime.subtract(end, { milliseconds: 1 });
  return dayOf(start) === dayOf(last)
    ? undefined
    : m.reservations_time_range(
        { start: dayMonth(start, locale), end: dayMonth(last, locale) },
        { locale }
      );
};

/**
 * A booking's time under its title. A booking within one day reads "Until
 * 17:00" when it starts at midnight (a day desk), else "14:00 – 15:00"; one
 * over several days reads "Until Wed 9 Dec". `date` puts the day before a
 * one-day time, for the list's next booking whose day the tile doesn't spell.
 */
export const bookingTimeLine = (
  start: DateTime.DateTime,
  end: DateTime.DateTime,
  locale: AppLocale,
  date?: string
): string => {
  const last = DateTime.isGreaterThan(end, start)
    ? DateTime.subtract(end, { milliseconds: 1 })
    : start;
  const endTime = formatInstant(end, locale, "time");
  if (dayOf(start) !== dayOf(last)) {
    if (isMidnight(start) && isMidnight(end)) {
      return m.reservations_time_until(
        { time: shortDate(last, locale) },
        { locale }
      );
    }
    // A timed booking into another day, such as an overnight stay, names the
    // end's date beside its time.
    const range = m.reservations_time_range(
      {
        start: formatInstant(start, locale, "time"),
        end: m.reservations_date_time(
          { date: shortDate(end, locale), time: endTime },
          { locale }
        ),
      },
      { locale }
    );
    return date === undefined
      ? range
      : m.reservations_date_time({ date, time: range }, { locale });
  }
  if (isMidnight(start)) {
    if (isMidnight(end)) {
      return date ?? shortDate(start, locale);
    }
    return date === undefined
      ? m.reservations_time_until({ time: endTime }, { locale })
      : m.reservations_time_date_until({ date, time: endTime }, { locale });
  }
  const range = m.reservations_time_range(
    { start: formatInstant(start, locale, "time"), end: endTime },
    { locale }
  );
  return date === undefined
    ? range
    : m.reservations_date_time({ date, time: range }, { locale });
};
