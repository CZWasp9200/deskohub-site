import { Option } from "effect";
import { isLocale, type Locale, locales } from "@/features/i18n";
import { type AudienceFilter, audienceSingleLocale } from "./audience-filter";
import type { CampaignLocalizedContent } from "./body/campaign-content";

/** Locale for recipients without a known or covered preference. */
export const campaignFallbackLocale: Locale = "cs-CZ";

/** Campaign locales in display order: the required fallback first. */
export const campaignLocales: readonly Locale[] = [
  campaignFallbackLocale,
  ...locales.filter((locale) => locale !== campaignFallbackLocale),
];

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

/**
 * Whether every recipient the audience can reach gets content meant for
 * them. A recipient in a locale without content gets the Czech fallback, so
 * the campaign needs Czech content unless the audience is restricted to a
 * single locale it has content for. A campaign without an audience is
 * unrestricted.
 */
export const campaignContentCoversAudience = (input: {
  readonly content: CampaignLocalizedContent;
  readonly audienceFilter: Option.Option<AudienceFilter>;
}): boolean =>
  input.content[campaignFallbackLocale] !== undefined ||
  input.audienceFilter.pipe(
    Option.flatMapNullishOr(audienceSingleLocale),
    Option.exists((locale) => input.content[locale] !== undefined)
  );
