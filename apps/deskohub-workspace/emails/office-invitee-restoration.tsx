import { type Locale, m } from "@/features/i18n";
import {
  type OfficeInviteeEmailReservation,
  officeInviteeEmailDetails,
  officeInviteeEmailReason,
} from "./_components/office-invitee-email-details";
import { ReservationEmailActionPanel } from "./_components/reservation-email-sections";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { officeInviteeRestorationPreviewProps } from "./_fixtures/office-invitee-preview-props";

export type OfficeInviteeRestorationEmailProps = {
  readonly locale: Locale;
  readonly reservation: OfficeInviteeEmailReservation;
  /**
   * The invited person's own link while the restored booking has time left.
   */
  readonly invitationUrl?: string;
  readonly accessReissued?: boolean;
};

/** The subject, which the inbox also previews. */
export const officeInviteeRestorationEmailSubject = ({
  locale,
  reservation,
}: Pick<OfficeInviteeRestorationEmailProps, "locale" | "reservation">) =>
  m.officeInviteeRestorationSubject(
    { booker: reservation.bookedBy },
    { locale }
  );

/**
 * Tells an invited person that the cancelled office they were invited to is
 * valid again, with their personal access page when the booking has time left.
 */
export function OfficeInviteeRestorationEmail(
  props: OfficeInviteeRestorationEmailProps
) {
  const { locale, reservation, invitationUrl, accessReissued } = props;

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={officeInviteeRestorationEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.officeInviteeRestorationHeading(
          { booker: reservation.bookedBy },
          { locale }
        )}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.officeInviteeRestorationBody({}, { locale })}
      </WorkspaceEmailBody>
      {accessReissued && (
        <WorkspaceEmailBody>
          {m.officeInviteeRestorationNewAccessCode({}, { locale })}
        </WorkspaceEmailBody>
      )}
      {invitationUrl && (
        <ReservationEmailActionPanel
          action={{
            button: m.reservationShowPinCode({}, { locale }),
            url: invitationUrl,
          }}
          locale={locale}
        />
      )}
      <WorkspaceEmailDetails
        details={officeInviteeEmailDetails(reservation, locale)}
      />
      <WorkspaceEmailNote>
        {officeInviteeEmailReason(reservation, locale)}
      </WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

OfficeInviteeRestorationEmail.PreviewProps =
  officeInviteeRestorationPreviewProps;

export default OfficeInviteeRestorationEmail;
