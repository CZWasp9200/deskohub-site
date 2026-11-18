import { type Locale, m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import {
  type OfficeInviteeEmailReservation,
  officeInviteeEmailDetails,
  officeInviteeEmailReason,
} from "./_components/office-invitee-email-details";
import {
  ReservationEmailActionPanel,
  ReservationEmailLocationPanel,
} from "./_components/reservation-email-sections";
import {
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { officeInvitationPreviewProps } from "./_fixtures/office-invitee-preview-props";

export type OfficeInvitationEmailProps = {
  readonly locale: Locale;
  readonly reservation: OfficeInviteeEmailReservation;
  /** The invited person's own link to the access page. */
  readonly invitationUrl: string;
};

/** The subject, which the inbox also previews. */
export const officeInvitationEmailSubject = ({
  locale,
  reservation,
}: Pick<OfficeInvitationEmailProps, "locale" | "reservation">) =>
  m.officeInvitationSubject({ booker: reservation.bookedBy }, { locale });

/**
 * Invites a person a booker added to a private office: what, when, who
 * booked it, and their personal link to the door code. It carries neither
 * the code nor how many people are coming.
 */
export function OfficeInvitationEmail(props: OfficeInvitationEmailProps) {
  const { locale, reservation, invitationUrl } = props;
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).format(temporalInstantToDate(reservation.reservedFrom));

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={officeInvitationEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.officeInvitationHeading(
          { booker: reservation.bookedBy, date },
          { locale }
        )}
      </WorkspaceEmailHeading>
      <ReservationEmailActionPanel
        action={{
          button: m.checkoutEmailCustomerAccessButton({}, { locale }),
          url: invitationUrl,
        }}
        locale={locale}
      />
      <ReservationEmailLocationPanel locale={locale} />
      <WorkspaceEmailDetails
        details={officeInviteeEmailDetails(reservation, locale)}
      />
      <WorkspaceEmailNote>
        {officeInviteeEmailReason(reservation, locale)}
      </WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

OfficeInvitationEmail.PreviewProps = officeInvitationPreviewProps;

export default OfficeInvitationEmail;
