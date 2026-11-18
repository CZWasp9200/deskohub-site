import type {
  CustomerInvitedReservation,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Array as Arr, Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import type { AppLocale } from "../../i18n/app-locale";
import { parseInstant } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import { bookingTimeLine } from "./booking-ticket-text";
import { type DateTileParts, dateTileParts } from "./booking-time";
import { reservationProductTitle } from "./reservation-labels";

/**
 * GET /reservations/invitations: the orders someone else booked that
 * invited the signed-in account's address. Read beside the history, on
 * mount and with its refresh.
 */
export const invitedReservationsAtom = customerDataRuntime.atom(
  Effect.service(CustomerApi).pipe(
    Effect.flatMap((api) =>
      api.reservations.listInvitedReservations({ query: {} })
    ),
    customerRead({ accountRead: true })
  )
);

/** The invited order the account holds, if any, for its access screen. */
export const invitedReservationOfOrderAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    Atom.make((get) =>
      Option.flatMap(
        AsyncResult.value(get(invitedReservationsAtom)),
        ({ current, past }) =>
          Arr.findFirst(
            [...current, ...past],
            (invited) => invited.orderId === orderId
          )
      )
    )
);

/** An invited order as the Reservations list shows it: read-only, no price. */
export interface InvitedReservationView {
  readonly orderId: CustomerReservationOrderId;
  readonly title: string;
  /** Its day's tile; none when its time can't be read. */
  readonly date: Option.Option<DateTileParts>;
  /** When, and who booked it when their name is known. */
  readonly detail: string;
}

export const invitedReservationView = (
  invited: CustomerInvitedReservation,
  locale: AppLocale
): InvitedReservationView => {
  const start = Option.flatMap(
    Option.fromNullishOr(invited.accessStartsAt),
    parseInstant
  );
  const end = Option.flatMap(
    Option.fromNullishOr(invited.accessEndsAt),
    parseInstant
  );
  return {
    orderId: invited.orderId,
    title: reservationProductTitle(invited.product, locale),
    date: Option.map(start, (at) => dateTileParts(at, locale)),
    detail: [
      Option.match(Option.all([start, end]), {
        onNone: () => m.reservations_value_unavailable({}, { locale }),
        onSome: ([from, until]) => bookingTimeLine(from, until, locale),
      }),
      ...Option.toArray(
        Option.map(Option.fromNullishOr(invited.bookedBy.name), (name) =>
          m.reservations_booked_by_name({ name }, { locale })
        )
      ),
    ].join(" · "),
  };
};
