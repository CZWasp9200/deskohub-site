import { payStateTokenQueryParam } from "@/features/checkout/pay-state-token-query";
import { reservationAccessTokenQueryParam } from "@/features/reservation/reservation-access-token";

/**
 * Query parameters whose signed value was issued for the URL's locale and
 * carries a guarantee in that language:
 * - A Pay state fixes the locale of the terms and operating rules the customer
 *   accepts and of the frozen accounting snapshot (the invoice language).
 * - A reservation access token on the invoice page lets the customer issue
 *   that invoice, which is generated in the reservation's locale.
 * Status and access links are exchanged for a locale-free cookie before any
 * locale decision, so their token never reaches this check.
 */
const localeBoundContinuationParams = [
  payStateTokenQueryParam,
  reservationAccessTokenQueryParam,
] as const;

/**
 * Whether a URL continues a flow bound to its own locale. Such a URL keeps the
 * locale it was issued in: a signed-in customer's saved language preference
 * must not move it, or the continuation would no longer validate.
 */
export const carriesLocaleBoundContinuation = (
  searchParams: Pick<URLSearchParams, "has">
): boolean =>
  localeBoundContinuationParams.some((param) => searchParams.has(param));
