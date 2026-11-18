import "@/shared/polyfills/temporal";
import type { OfficeInvitationEmailProps } from "../office-invitation";
import type { OfficeInviteeCancellationEmailProps } from "../office-invitee-cancellation";
import type { OfficeInviteeRestorationEmailProps } from "../office-invitee-restoration";

const previewReservation = {
  reservedFrom: Temporal.Instant.from("2026-11-17T23:00:00Z"),
  reservedUntil: Temporal.Instant.from("2026-11-18T23:00:00Z"),
  bookedBy: "Alex Sample",
};

export const officeInvitationPreviewProps = {
  locale: "en-US",
  reservation: previewReservation,
  invitationUrl:
    "https://workspace.deskohub.cz/en-US/reservation/access/preview?invitationToken=preview",
} satisfies OfficeInvitationEmailProps;

export const officeInviteeCancellationPreviewProps = {
  locale: "en-US",
  reservation: previewReservation,
} satisfies OfficeInviteeCancellationEmailProps;

export const officeInviteeRestorationPreviewProps = {
  locale: "en-US",
  reservation: previewReservation,
  invitationUrl: officeInvitationPreviewProps.invitationUrl,
  accessReissued: true,
} satisfies OfficeInviteeRestorationEmailProps;
