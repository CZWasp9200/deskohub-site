import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDateRange } from "@/features/reservation/reservation-date";
import { workspaceSiteConstants } from "@/shared/utils";
import type { WorkspaceEmailDetail } from "../workspace-email-detail";

/** What an invited person's emails say about the office they were invited to. */
export interface OfficeInviteeEmailReservation {
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
  /** The booker's name, as the invitation names them. */
  readonly bookedBy: string;
}

/**
 * The space, its date and who booked it: all an invited person sees of the
 * order. Never the price, the references, the other people or a door code.
 */
export const officeInviteeEmailDetails = (
  reservation: OfficeInviteeEmailReservation,
  locale: Locale
): WorkspaceEmailDetail[] => [
  {
    label: m.officeInvitationSpaceLabel({}, { locale }),
    value: getWorkspaceOfficeProductTitle(locale),
  },
  {
    label: m.officeInvitationDateLabel({}, { locale }),
    value: formatReservationDisplayDateRange(
      reservation.reservedFrom,
      reservation.reservedUntil,
      locale
    ),
  },
  {
    label: m.officeInvitationBookedByLabel({}, { locale }),
    value: reservation.bookedBy,
  },
];

/** Why the invited person got the email, and where to ask. */
export const officeInviteeEmailReason = (
  reservation: Pick<OfficeInviteeEmailReservation, "bookedBy">,
  locale: Locale
) =>
  m.officeInvitationReason(
    {
      booker: reservation.bookedBy,
      email: workspaceSiteConstants.contact.infoEmail,
    },
    { locale }
  );
