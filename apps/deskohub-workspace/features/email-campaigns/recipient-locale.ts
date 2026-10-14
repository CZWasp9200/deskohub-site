import { isLocale, type Locale } from "@/features/i18n";

/** Locale for recipients without a known or covered preference. */
export const campaignFallbackLocale: Locale = "cs-CZ";

/**
 * The language a campaign email reaches a customer in, and the value the
 * audience locale condition filters on: the linked account's preference,
 * then the latest reservation's locale, then the marketing consent's locale,
 * then Czech.
 */
export const resolveRecipientLocale = (sources: {
  readonly accountLocale: string | null;
  readonly latestReservationLocale: string | null;
  readonly consentLocale: string | null;
}): Locale =>
  [
    sources.accountLocale,
    sources.latestReservationLocale,
    sources.consentLocale,
  ].find((locale): locale is Locale => locale !== null && isLocale(locale)) ??
  campaignFallbackLocale;
