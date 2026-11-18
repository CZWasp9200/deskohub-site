import type { CustomerReservationSummary } from "@deskohub/workspace-customer-api";
import type {
  CustomerReservationAccess,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Array as Arr, DateTime, Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import { opensReservationStatus } from "../account-gating";
import type { TicketBadgeKind } from "./booking-ticket-model";
import {
  bookingDateRange,
  bookingTimeLine,
  historyBadgeKind,
  shortDate,
} from "./booking-ticket-text";
import {
  type BookingCountdown,
  bookingCountdown,
  type DateTileParts,
  dateTileParts,
} from "./booking-time";
import { reservationProductTitle } from "./reservation-labels";
import type {
  SavedReservation,
  SavedReservationHistory,
} from "./reservations-cache";

/**
 * A reservation the list shows. A fresh history row has more (the other
 * party), which the list doesn't show; saved rows have only what the device
 * keeps, never today's PIN.
 */
export type ReservationListRow = SavedReservation & {
  readonly todayAccess?: CustomerReservationAccess;
  /** A fresh row's withdrawal entry point; saved rows never keep it. */
  readonly withdrawal?: CustomerReservationSummary["withdrawal"];
};

/** The list's groups, as the site's account page shows them. */
export interface ReservationGroups {
  /** The current reservation shown large, the first of the current ones. */
  readonly featured: Option.Option<ReservationListRow>;
  /** The other current and upcoming reservations, as compact rows. */
  readonly moreCurrent: ReadonlyArray<ReservationListRow>;
  readonly past: ReadonlyArray<ReservationListRow>;
  /** Reservations whose time couldn't be read. */
  readonly undated: ReadonlyArray<ReservationListRow>;
  /** Whether the account has no reservations at all. */
  readonly empty: boolean;
}

const instantOf = (iso: string | null | undefined) =>
  Option.flatMap(Option.fromNullishOr(iso), parseInstant);

const hasEndedBy =
  (now: DateTime.DateTime) =>
  ({ endsAt }: ReservationListRow) =>
    Option.exists(instantOf(endsAt), (end) =>
      DateTime.isLessThanOrEqualTo(end, now)
    );

/**
 * Groups a history at `now`. A current reservation stays current until it
 * ends; one that has ended since the history was read (a saved history read
 * later) moves to the top of the past ones.
 */
export const reservationGroups = (
  history: {
    readonly [Group in keyof SavedReservationHistory]: ReadonlyArray<ReservationListRow>;
  },
  now: DateTime.DateTime
): ReservationGroups => {
  const ended = history.current.filter(hasEndedBy(now));
  const current = history.current.filter((row) => !ended.includes(row));
  const past = [...ended, ...history.past];
  return {
    featured: Arr.head(current),
    moreCurrent: current.slice(1),
    past,
    undated: history.unavailable,
    empty:
      current.length === 0 &&
      past.length === 0 &&
      history.unavailable.length === 0,
  };
};

const timeLineOf = (
  row: ReservationListRow,
  locale: AppLocale,
  date?: (start: DateTime.DateTime) => string
): string =>
  Option.match(Option.all([instantOf(row.startsAt), instantOf(row.endsAt)]), {
    onNone: () => m.reservations_value_unavailable({}, { locale }),
    onSome: ([start, end]) =>
      bookingTimeLine(start, end, locale, date?.(start)),
  });

/** A later or past reservation as its compact row shows it. */
export interface ReservationRowView {
  readonly title: string;
  /** Its day's tile; none when its time can't be read. */
  readonly date: Option.Option<DateTileParts>;
  /**
   * The time (with seats for an office), or for a past cancelled one only
   * that it was cancelled. Always shown, the badge beside it.
   */
  readonly detail: string;
  /** The status badge of an upcoming one not confirmed yet. */
  readonly badge: Option.Option<TicketBadgeKind>;
}

const seatsOf = (row: ReservationListRow, locale: AppLocale) =>
  row.product.kind === "office" && row.seats !== null
    ? Option.some(m.reservations_seats({ count: row.seats }, { locale }))
    : Option.none();

/** A compact row's time: the date range for a booking over several days. */
const rowTimeLineOf = (row: ReservationListRow, locale: AppLocale): string =>
  Option.match(Option.all([instantOf(row.startsAt), instantOf(row.endsAt)]), {
    onNone: () => timeLineOf(row, locale),
    onSome: ([start, end]) =>
      bookingDateRange(start, end, locale) ?? timeLineOf(row, locale),
  });

export const reservationRowView = (
  row: ReservationListRow,
  place: "later" | "past",
  locale: AppLocale
): ReservationRowView => {
  const cancelled = row.status === "cancelled";
  const badge = historyBadgeKind(row.status);
  return {
    title: reservationProductTitle(row.product, locale),
    date: Option.map(instantOf(row.startsAt), (start) =>
      dateTileParts(start, locale)
    ),
    // A past booking says only that it was cancelled, never "not charged":
    // the history can't tell whether a payment was taken.
    detail:
      place === "past" && cancelled
        ? m.reservations_status_cancelled({}, { locale })
        : rowTimeLineOf(row, locale),
    badge:
      place === "later" && (badge === "pending" || badge === "attention")
        ? Option.some(badge)
        : Option.none(),
  };
};

/** What the next booking's ticket shows under its stub line. */
export type NextAccess =
  /** Today's PIN, shown on the ticket. */
  | { readonly _tag: "Pin"; readonly code: string; readonly until: string }
  /** The PIN waits on its screen. */
  | { readonly _tag: "Ready"; readonly from: Option.Option<string> }
  /** The booking isn't confirmed yet: the PIN follows payment. */
  | { readonly _tag: "AfterPayment" };

/** The next booking as its ticket shows it. */
export interface NextReservationView {
  readonly title: string;
  readonly badge: TicketBadgeKind;
  readonly countdown: Option.Option<BookingCountdown>;
  readonly date: Option.Option<DateTileParts>;
  /** Its day and time. */
  readonly when: string;
  readonly access: NextAccess;
}

export const nextReservationView = (
  row: ReservationListRow,
  now: DateTime.DateTime,
  locale: AppLocale
): NextReservationView => {
  const start = instantOf(row.startsAt);
  const end = instantOf(row.endsAt);
  const countdown = Option.flatMap(Option.all([start, end]), ([start, end]) =>
    bookingCountdown(now, start, end)
  );
  const isToday = Option.exists(
    countdown,
    ({ kind }) => kind === "open-now" || kind === "today"
  );
  const badge = historyBadgeKind(row.status);
  const timeOf = (iso: string | undefined) =>
    Option.map(instantOf(iso), (instant) =>
      formatInstant(instant, locale, "time")
    );
  const access = (): NextAccess => {
    if (badge !== "confirmed") return { _tag: "AfterPayment" };
    if (row.todayAccess !== undefined) {
      return {
        _tag: "Pin",
        code: row.todayAccess.code,
        until: Option.getOrElse(timeOf(row.todayAccess.accessEndsAt), () => ""),
      };
    }
    return {
      _tag: "Ready",
      from: Option.map(instantOf(row.accessStartsAt), (from) =>
        m.reservations_date_time(
          {
            date: shortDate(from, locale),
            time: formatInstant(from, locale, "time"),
          },
          { locale }
        )
      ),
    };
  };
  return {
    title: reservationProductTitle(row.product, locale),
    badge,
    countdown,
    date: Option.map(start, (start) => dateTileParts(start, locale)),
    when: [
      timeLineOf(row, locale, (start) =>
        isToday
          ? m.reservations_countdown_today({}, { locale })
          : shortDate(start, locale)
      ),
      ...Option.toArray(seatsOf(row, locale)),
    ].join(" · "),
    access: access(),
  };
};

/** The order a row opens the status screen of; none when it isn't navigable. */
export const reservationStatusTarget = (
  row: ReservationListRow
): Option.Option<CustomerReservationOrderId> =>
  opensReservationStatus(row)
    ? Option.fromNullishOr(row.orderId)
    : Option.none();
