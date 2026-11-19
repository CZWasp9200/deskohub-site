import { Match } from "effect";
import {
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import { formatCoworkReservationDisplayDate } from "@/features/reservation/cowork-reservation-display-date";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import {
  formatMeetingRoomReservationDisplayTimeValue,
  formatMeetingRoomSetupStart,
} from "@/features/reservation/meeting-room-reservation-display-time";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateRange,
} from "@/features/reservation/reservation-date";
import type { WorkspaceEmailDetail } from "../workspace-email-detail";

/** The reservation facts that the reservation emails describe. */
export type ReservationEmailReservation = Pick<
  WorkspaceReservationDetails,
  | "id"
  | "dotyposReservationId"
  | "reservationDetails"
  | "reservedFrom"
  | "reservedUntil"
  | "setupFrom"
  | "seats"
>;

const coworkDetails = (
  reservation: ReservationEmailReservation,
  details: StoredCoworkReservationDetails,
  locale: Locale
): WorkspaceEmailDetail[] => [
  {
    label: m.reservationEmailTierLabel({}, { locale }),
    value: getWorkspaceProductTierTitle(details.entryTier, locale),
  },
  {
    label: m.reservationEmailDateLabel({}, { locale }),
    value: formatCoworkReservationDisplayDate(
      {
        tier: details.entryTier,
        interval: {
          startsAt: reservation.reservedFrom,
          endsAt: reservation.reservedUntil,
        },
      },
      locale
    ),
  },
  {
    label: m.reservationEmailCoffeeLabel({}, { locale }),
    value: details.coffee
      ? m.checkoutStatusYes({}, { locale })
      : m.checkoutStatusNo({}, { locale }),
  },
  ...Match.value(details).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      "open-space": () => [],
      "reserved-desk": ({ monitorOption }) =>
        monitorOption
          ? [
              {
                label: m.reservationEmailMonitorsLabel({}, { locale }),
                value: getWorkspaceProductMonitorTitle(monitorOption, locale),
              } satisfies WorkspaceEmailDetail,
            ]
          : [],
      basic: () => [],
      plus: () => [],
      profi: ({ monitorOption }) => [
        {
          label: m.reservationEmailMonitorsLabel({}, { locale }),
          value: getWorkspaceProductMonitorTitle(monitorOption, locale),
        } satisfies WorkspaceEmailDetail,
      ],
    })
  ),
];

/** A meeting-room booking's product, date, time and early-setup start. */
export const meetingRoomEmailDetails = (
  reservation: Pick<
    ReservationEmailReservation,
    "reservedFrom" | "reservedUntil" | "setupFrom"
  >,
  locale: Locale
): WorkspaceEmailDetail[] => [
  {
    label: m.reservationEmailReservationLabel({}, { locale }),
    value: m.reservationTierMeetingRoomTitle({}, { locale }),
  },
  {
    label: m.reservationEmailDateLabel({}, { locale }),
    value: formatReservationDisplayDate(reservation.reservedFrom, locale),
  },
  {
    label: m.reservationEmailTimeLabel({}, { locale }),
    value: formatMeetingRoomReservationDisplayTimeValue(
      {
        startsAt: reservation.reservedFrom,
        endsAt: reservation.reservedUntil,
      },
      locale,
      m.reservationMeetingRoomDurationWholeDay({}, { locale })
    ),
  },
  ...(reservation.setupFrom
    ? [
        {
          label: m.reservationEmailSetupLabel({}, { locale }),
          value: formatMeetingRoomSetupStart(
            {
              setupStart: reservation.setupFrom,
              bookedStart: reservation.reservedFrom,
            },
            locale
          ),
        },
      ]
    : []),
];

/**
 * Who is coming to an office booked with a people list, as its booker's
 * confirmation lists them: the booker while they attend, then each invited
 * address in order.
 */
export interface ReservationEmailPeople {
  /** The booker's name, while they attend themselves. */
  readonly contactName?: string;
  readonly invitees: readonly string[];
}

const officePeopleDetail = (
  people: ReservationEmailPeople,
  locale: Locale
): WorkspaceEmailDetail => {
  const [first = "", ...lines] = [
    ...(people.contactName === undefined
      ? []
      : [
          m.officeInvitationPeopleYou({ name: people.contactName }, { locale }),
        ]),
    ...people.invitees,
  ];
  return {
    label: m.officeInvitationPeopleLabel({}, { locale }),
    value: first,
    lines,
    ...(people.invitees.length > 0 && {
      note: m.officeInvitationPeopleNote({}, { locale }),
    }),
  };
};

const productDetails = (
  reservation: ReservationEmailReservation,
  locale: Locale,
  people?: ReservationEmailPeople
): WorkspaceEmailDetail[] =>
  Match.value(reservation.reservationDetails).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (details) => coworkDetails(reservation, details, locale),
      "meeting-room": () => meetingRoomEmailDetails(reservation, locale),
      office: () => [
        {
          label: m.reservationEmailReservationLabel({}, { locale }),
          value: getWorkspaceOfficeProductTitle(locale),
        },
        {
          label: m.reservationEmailDateLabel({}, { locale }),
          value: formatReservationDisplayDateRange(
            reservation.reservedFrom,
            reservation.reservedUntil,
            locale
          ),
        },
        people
          ? officePeopleDetail(people, locale)
          : {
              label: m.reservationEmailSeatsLabel({}, { locale }),
              value: String(reservation.seats),
            },
      ],
    })
  );

/**
 * What was booked and when, followed by the Dotypos reservation and order
 * references.
 */
export const reservationEmailDetails = (
  reservation: ReservationEmailReservation,
  locale: Locale,
  /** Who is coming, for an office booked with a people list. */
  people?: ReservationEmailPeople
): WorkspaceEmailDetail[] => [
  ...productDetails(reservation, locale, people),
  ...(reservation.dotyposReservationId
    ? [
        {
          label: m.checkoutEmailDotyposReservationIdLabel({}, { locale }),
          value: reservation.dotyposReservationId,
        },
      ]
    : []),
  {
    label: m.checkoutStatusOrderIdLabel({}, { locale }),
    value: reservation.id,
  },
];
