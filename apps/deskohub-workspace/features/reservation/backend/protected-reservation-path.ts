import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type ReservationAccessToken,
  type ReservationInvitationToken,
  reservationAccessTokenQueryParam,
  reservationInvitationTokenQueryParam,
} from "@/features/reservation/reservation-access-token";
import { reservationAccessPath } from "@/features/reservation/routes";

export type ProtectedReservationPathInput = {
  readonly locale: Locale | string;
  readonly orderId: WorkspaceReservationId;
  readonly accessToken: ReservationAccessToken;
  readonly setBypassCookie?: boolean;
};

export const getProtectedReservationPath = (
  reservationPath: string,
  input: ProtectedReservationPathInput
) =>
  getCapabilityPath(reservationPath, input, [
    reservationAccessTokenQueryParam,
    input.accessToken,
  ]);

/** An invited person's personal link to the reservation's access page. */
export const getReservationInvitationPath = (input: {
  readonly locale: Locale | string;
  readonly orderId: WorkspaceReservationId;
  readonly invitationToken: ReservationInvitationToken;
  readonly setBypassCookie?: boolean;
}) =>
  getCapabilityPath(reservationAccessPath, input, [
    reservationInvitationTokenQueryParam,
    input.invitationToken,
  ]);

const getCapabilityPath = (
  reservationPath: string,
  input: {
    readonly locale: Locale | string;
    readonly orderId: WorkspaceReservationId;
    readonly setBypassCookie?: boolean;
  },
  [param, token]: readonly [string, string]
) => {
  const url = new URL(
    `/${input.locale}${reservationPath}/${input.orderId}`,
    "https://deskohub.local"
  );
  url.searchParams.set(param, token);
  appendVercelPreviewProtectionBypass(url, {
    setBypassCookie: input.setBypassCookie,
  });

  return `${url.pathname}${url.search}`;
};
