import type { Locale } from "@/features/i18n";

/** Admin-facing language names for campaign content and recipient locales. */
export const campaignLocaleNames = {
  "cs-CZ": "Czech",
  "en-US": "English",
} as const satisfies Record<Locale, string>;

export const describeCampaignLocales = (locales: readonly Locale[]) =>
  locales.map((locale) => campaignLocaleNames[locale]).join(", ");
