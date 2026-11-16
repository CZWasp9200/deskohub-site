import { Column, Img, Row, Section, Text } from "react-email";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import { getBookedCoworkStay } from "@/features/reservation/cowork-stay";
import { formatReservationDisplayDateTimeRange } from "@/features/reservation/reservation-date";
import { workspaceSiteConstants } from "@/shared/utils";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import {
  type ReservationEmailReservation,
  reservationEmailDetails,
} from "./_components/reservation-email-details";
import {
  ReservationEmailActionPanel,
  ReservationEmailLocationPanel,
} from "./_components/reservation-email-sections";
import {
  WorkspaceEmailHeading,
  WorkspaceEmailLabel,
  WorkspaceEmailNote,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { customerReservationPreviewProps } from "./_fixtures/preview-props";

// Table-map rendering is intentionally omitted. The removed legacy fulfillment
// renderer generated a table-map PNG attachment; that flow must be ported into
// this React Email template before table maps can be enabled again.
export type CustomerReservationEmailProps = {
  readonly locale: Locale;
  readonly reservation: ReservationEmailReservation &
    Pick<WorkspaceReservationDetails, "placement">;
  /** The access page, which shows the access code. */
  readonly accessUrl: string;
  /** The invoice download, issued in the reservation's own locale. */
  readonly invoiceUrl: string;
  readonly network?: {
    readonly ssid: string;
    readonly password: string;
    readonly qrImageSrc?: string;
  };
};

/** The subject, which the inbox also previews. */
export const customerReservationEmailSubject = ({
  locale,
}: Pick<CustomerReservationEmailProps, "locale">) =>
  m.checkoutEmailCustomerAccessSubject({}, { locale });

/**
 * The arrival date, or, for an overnight stay, which ends on the next date,
 * both dates with their times.
 */
const headingDate = ({
  reservation,
  locale,
}: CustomerReservationEmailProps) => {
  const { reservationDetails, reservedFrom, reservedUntil } = reservation;
  return reservationDetails.kind === "cowork" &&
    getBookedCoworkStay({
      tier: reservationDetails.entryTier,
      interval: { startsAt: reservedFrom, endsAt: reservedUntil },
    }) === "overnight"
    ? formatReservationDisplayDateTimeRange(reservedFrom, reservedUntil, locale)
    : new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: workspaceSiteConstants.location.timeZone,
      }).format(temporalInstantToDate(reservedFrom));
};

/** Confirms a paid reservation to its customer, with access and directions. */
export function CustomerReservationEmail(props: CustomerReservationEmailProps) {
  const { locale, reservation, accessUrl, invoiceUrl, network } = props;
  const { table } = reservation.placement;

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={customerReservationEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.checkoutEmailCustomerAccessHeading(
          { date: headingDate(props) },
          { locale }
        )}
      </WorkspaceEmailHeading>

      <ReservationEmailActionPanel
        action={{
          button: m.checkoutEmailCustomerAccessButton({}, { locale }),
          url: accessUrl,
        }}
        locale={locale}
        {...(table && { table })}
      />
      <ReservationEmailLocationPanel locale={locale} />

      {network && (
        <Section className="mt-6 rounded-2xl border border-[#cfe6f8] bg-sky px-5 py-5">
          <Row>
            <Column className="block w-full align-middle sm:table-cell sm:w-auto">
              <WorkspaceEmailLabel>
                {m.checkoutEmailNetworkHeading({}, { locale })}
              </WorkspaceEmailLabel>
              <Text className="m-0 mt-3 text-[14px] leading-[22px] text-navy">
                <strong>
                  {m.checkoutEmailNetworkSsidLabel({}, { locale })}:
                </strong>
                <br />
                {network.ssid}
              </Text>
              <Text className="m-0 mt-2 text-[14px] leading-[22px] text-navy">
                <strong>
                  {m.checkoutEmailNetworkPasswordLabel({}, { locale })}:
                </strong>
                <br />
                {network.password}
              </Text>
            </Column>
            {network.qrImageSrc && (
              <Column className="block w-full pt-4 text-center align-middle sm:table-cell sm:w-[168px] sm:pt-0 sm:pl-5 sm:text-right">
                <Img
                  alt={m.checkoutEmailNetworkHeading({}, { locale })}
                  className="mx-auto block h-auto rounded-xl border border-[#d8edf8] bg-white p-2 sm:mr-0 sm:ml-auto"
                  src={network.qrImageSrc}
                  width="144"
                />
              </Column>
            )}
          </Row>
        </Section>
      )}

      <WorkspaceEmailDetails
        details={[
          ...reservationEmailDetails(reservation, locale),
          {
            href: invoiceUrl,
            label: m.checkoutEmailCustomerInvoiceLabel({}, { locale }),
            value: m.checkoutEmailCustomerInvoiceDownload({}, { locale }),
          },
        ]}
      />
      <WorkspaceEmailNote>
        {m.reservationEmailCustomerFollowUp(
          { email: workspaceSiteConstants.contact.infoEmail },
          { locale }
        )}
      </WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

CustomerReservationEmail.PreviewProps = customerReservationPreviewProps;

export default CustomerReservationEmail;
