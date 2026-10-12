import { stripLocaleFromPathname } from "@deskohub/i18n/pathname";
import { payStateTokenQueryParam } from "@/features/checkout/pay-state-token-query";
import { locales } from "@/features/i18n/routing";
import { reservationAccessTokenQueryParam } from "@/features/reservation/reservation-access-token";
import {
  coworkReservationPath,
  meetingRoomReservationPath,
  officeReservationPath,
  reservationInvoicePath,
} from "@/features/reservation/routes";

const checkoutPayPath = "/checkout/pay";

/**
 * The routes that continue a flow bound to the locale its signed value was
 * issued in:
 * - The Pay page, and the reservation pages that restore an edited
 *   reservation, take a Pay state. It fixes the language of the terms and
 *   operating rules the customer accepts and of the frozen accounting
 *   snapshot (the invoice language).
 * - The invoice page takes a reservation access token and issues the invoice
 *   in the reservation's locale.
 * Status and access links are exchanged for a locale-free cookie before any
 * locale decision, so their token never reaches this check.
 */
const localeBoundContinuations: readonly {
  readonly param: string;
  readonly matches: (pathname: string) => boolean;
}[] = [
  {
    param: payStateTokenQueryParam,
    matches: (pathname) =>
      [
        checkoutPayPath,
        coworkReservationPath,
        meetingRoomReservationPath,
        officeReservationPath,
      ].includes(pathname),
  },
  {
    param: reservationAccessTokenQueryParam,
    matches: (pathname) =>
      pathname.startsWith(`${reservationInvoicePath}/`) &&
      /^[^/]+$/.test(pathname.slice(reservationInvoicePath.length + 1)),
  },
];

/**
 * Whether a URL continues a flow bound to its own locale: a supported route
 * carrying a non-empty value of its signed parameter. Such a URL keeps the
 * locale it was issued in, since a signed-in customer's saved language
 * preference would move it to a locale where it no longer validates. Any
 * other URL follows the preference, whatever parameters it carries.
 */
export const carriesLocaleBoundContinuation = ({
  pathname,
  searchParams,
}: {
  readonly pathname: string;
  readonly searchParams: Pick<URLSearchParams, "get">;
}): boolean => {
  const route = stripLocaleFromPathname(pathname, locales);
  return localeBoundContinuations.some(
    ({ param, matches }) =>
      matches(route) && (searchParams.get(param)?.trim() ?? "") !== ""
  );
};
