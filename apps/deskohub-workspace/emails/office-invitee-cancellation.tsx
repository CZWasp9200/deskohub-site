import { type Locale, m } from "@/features/i18n";
import {
  type OfficeInviteeEmailReservation,
  officeInviteeEmailDetails,
  officeInviteeEmailReason,
} from "./_components/office-invitee-email-details";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { officeInviteeCancellationPreviewProps } from "./_fixtures/office-invitee-preview-props";

export type OfficeInviteeCancellationEmailProps = {
  readonly locale: Locale;
  readonly reservation: OfficeInviteeEmailReservation;
};

/** The subject, which the inbox also previews and the heading repeats. */
export const officeInviteeCancellationEmailSubject = ({
  locale,
  reservation,
}: OfficeInviteeCancellationEmailProps) =>
  m.officeInviteeCancellationSubject(
    { booker: reservation.bookedBy },
    { locale }
  );

/**
 * Tells an invited person that the office they were invited to was
 * cancelled and their door code no longer works. Payment and refunds are
 * the booker's, so it never mentions them.
 */
export function OfficeInviteeCancellationEmail(
  props: OfficeInviteeCancellationEmailProps
) {
  const { locale, reservation } = props;
  const subject = officeInviteeCancellationEmailSubject(props);

  return (
    <WorkspaceEmailLayout locale={locale} preview={subject}>
      <WorkspaceEmailHeading>{subject}</WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.officeInviteeCancellationBody({}, { locale })}
      </WorkspaceEmailBody>
      <WorkspaceEmailDetails
        details={officeInviteeEmailDetails(reservation, locale)}
      />
      <WorkspaceEmailNote>
        {officeInviteeEmailReason(reservation, locale)}
      </WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

OfficeInviteeCancellationEmail.PreviewProps =
  officeInviteeCancellationPreviewProps;

export default OfficeInviteeCancellationEmail;
