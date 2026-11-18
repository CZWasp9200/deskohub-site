import type {
  CustomerEstablishment,
  CustomerOrderState,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Array as Arr, type DateTime, Option } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import Armchair from "lucide-react-native/icons/armchair";
import Clock from "lucide-react-native/icons/clock";
import MapPin from "lucide-react-native/icons/map-pin";
import Monitor from "lucide-react-native/icons/monitor";
import Receipt from "lucide-react-native/icons/receipt";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import type { TicketLead, TicketMetaLine } from "./booking-ticket";
import type { BookingTicketModel } from "./booking-ticket-model";
import {
  bookingTimeLine,
  priceText,
  shortDate,
  ticketLead,
} from "./booking-ticket-text";
import {
  bookingCountdown,
  type DateTileParts,
  dateTileParts,
} from "./booking-time";
import type { BookingEvent } from "./calendar-event";
import { establishmentPlace } from "./establishment";
import {
  reservationKindTitle,
  reservationProductTitle,
} from "./reservation-labels";
import type { ReservationListRow } from "./reservation-list-model";
import { reservationsListAtom } from "./reservations-list-state";

/**
 * The order's entry in the reservations list the app already holds (fresh
 * or saved), if any: what the order's status doesn't carry, such as the
 * product's tier and the lock's window, comes from there.
 */
export const reservationOfOrderAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    Atom.make((get) =>
      Option.flatMap(
        AsyncResult.value(get(reservationsListAtom)),
        ({ groups }) =>
          Arr.findFirst(
            [
              ...Option.toArray(groups.featured),
              ...groups.moreCurrent,
              ...groups.past,
              ...groups.undated,
            ],
            (row) => row.orderId === orderId
          )
      )
    )
);

/** An order's booking ticket, as text. */
export interface OrderTicketView {
  readonly lead: TicketLead | undefined;
  readonly date: DateTileParts | undefined;
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
  readonly meta: ReadonlyArray<TicketMetaLine>;
  /** When the PIN starts working, under the PIN button. */
  readonly accessHint: string | undefined;
  /** The booking as a calendar event, once its times are known. */
  readonly event: BookingEvent | undefined;
}

const instantOf = (iso: string | undefined) =>
  Option.flatMap(Option.fromUndefinedOr(iso), parseInstant);

/**
 * The product's catalog name: the list's product when the list holds the
 * order (its tier), else the tier the order would book again, else its kind.
 */
const orderTitle = (
  order: CustomerOrderState,
  reservation: Option.Option<ReservationListRow>,
  locale: AppLocale
) =>
  Option.match(reservation, {
    onSome: (row) => reservationProductTitle(row.product, locale),
    onNone: () => {
      const tier = order.bookedSelection?.selection.tier;
      return tier === undefined
        ? reservationKindTitle(order.kind, locale)
        : reservationProductTitle({ kind: "cowork", tier }, locale);
    },
  });

/** The booking's extras: early setup, a monitor workstation, office seats. */
const extras = (
  order: CustomerOrderState,
  locale: AppLocale
): ReadonlyArray<TicketMetaLine> => {
  const selection = order.bookedSelection?.selection;
  return [
    ...Option.toArray(
      Option.map(instantOf(order.setupStartsAt), (setup) => ({
        key: "setup",
        icon: Clock,
        text: m.reservations_setup_from(
          { time: formatInstant(setup, locale, "time") },
          { locale }
        ),
      }))
    ),
    ...(selection?.monitorOption === undefined
      ? []
      : [
          {
            key: "monitor",
            icon: Monitor,
            text: m.booking_checkout_line_workstation({}, { locale }),
          },
        ]),
    ...(order.kind === "office" && selection?.seats !== undefined
      ? [
          {
            key: "seats",
            icon: Armchair,
            text: m.reservations_seats({ count: selection.seats }, { locale }),
          },
        ]
      : []),
  ];
};

export const orderTicketView = ({
  order,
  model,
  reservation,
  establishment,
  now,
  locale,
}: {
  readonly order: CustomerOrderState;
  readonly model: BookingTicketModel;
  readonly reservation: Option.Option<ReservationListRow>;
  readonly establishment: Option.Option<CustomerEstablishment>;
  readonly now: DateTime.DateTime;
  readonly locale: AppLocale;
}): OrderTicketView => {
  const times = Option.all([
    instantOf(order.startsAt),
    instantOf(order.endsAt),
  ]);
  const accessStartsAt = Option.flatMap(reservation, (row) =>
    Option.flatMap(Option.fromNullishOr(row.accessStartsAt), parseInstant)
  );
  const title = orderTitle(order, reservation, locale);
  // A withdrawn booking won't happen: no countdown, PIN hint or calendar.
  const withdrawn = model.stub._tag === "Withdrawn";
  return {
    event: withdrawn
      ? undefined
      : Option.getOrUndefined(
          Option.map(times, ([start, end]) => ({
            orderId: order.orderId,
            title,
            start,
            end,
            location: Option.getOrUndefined(
              Option.map(establishment, (place) => place.formattedAddress)
            ),
          }))
        ),
    lead: withdrawn
      ? undefined
      : ticketLead(
          model.reason,
          Option.flatMap(times, ([start, end]) =>
            bookingCountdown(now, start, end)
          ),
          locale
        ),
    date: Option.getOrUndefined(
      Option.map(times, ([start]) => dateTileParts(start, locale))
    ),
    title,
    lines: [
      Option.match(times, {
        onNone: () => m.reservations_value_unavailable({}, { locale }),
        onSome: ([start, end]) => bookingTimeLine(start, end, locale),
      }),
    ],
    meta: [
      ...Option.toArray(
        Option.map(establishment, (place) => ({
          key: "place",
          icon: MapPin,
          text: establishmentPlace(place),
        }))
      ),
      ...extras(order, locale),
      ...(order.total === undefined
        ? []
        : [
            {
              key: "price",
              icon: Receipt,
              text: priceText(
                formatMoney(order.total, locale),
                model.price,
                locale
              ),
            },
          ]),
    ],
    accessHint: withdrawn
      ? undefined
      : Option.getOrUndefined(
          Option.map(accessStartsAt, (from) =>
            m.reservations_pin_works_from(
              {
                time: m.reservations_date_time(
                  {
                    date: shortDate(from, locale),
                    time: formatInstant(from, locale, "time"),
                  },
                  { locale }
                ),
              },
              { locale }
            )
          )
        ),
  };
};
