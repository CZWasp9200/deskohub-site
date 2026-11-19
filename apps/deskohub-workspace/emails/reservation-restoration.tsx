import { type Locale, m } from "@/features/i18n";
import {
  type ReservationEmailReservation,
  reservationEmailDetails,
} from "./_components/reservation-email-details";
import { ReservationEmailActionPanel } from "./_components/reservation-email-sections";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { reservationRestorationPreviewProps } from "./_fixtures/preview-props";

export type ReservationRestorationEmailProps = {
  readonly locale: Locale;
  readonly reservation: ReservationEmailReservation;
  /**
   * The access page, which shows the access code. Present only when the
   * restoration issued the reservation a new access code.
   */
  readonly accessUrl?: string;
};

/** The subject, which the inbox also previews. */
export const reservationRestorationEmailSubject = ({
  locale,
}: Pick<ReservationRestorationEmailProps, "locale">) =>
  m.reservationRestorationEmailSubject({}, { locale });

/**
 * Tells the customer that a cancelled reservation is valid again. It says
 * nothing about payment or refunds and never carries the access code itself.
 */
export function ReservationRestorationEmail(
  props: ReservationRestorationEmailProps
) {
  const { locale, reservation, accessUrl } = props;

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={reservationRestorationEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.reservationRestorationEmailHeading({}, { locale })}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.reservationRestorationEmailBody({}, { locale })}
      </WorkspaceEmailBody>
      {accessUrl && (
        <>
          <WorkspaceEmailBody>
            {m.reservationRestorationEmailNewAccessCode({}, { locale })}
          </WorkspaceEmailBody>
          <ReservationEmailActionPanel
            action={{
              button: m.reservationShowPinCode({}, { locale }),
              url: accessUrl,
            }}
            locale={locale}
          />
        </>
      )}
      <WorkspaceEmailDetails
        details={reservationEmailDetails(reservation, locale)}
      />
    </WorkspaceEmailLayout>
  );
}

ReservationRestorationEmail.PreviewProps = reservationRestorationPreviewProps;

export default ReservationRestorationEmail;
