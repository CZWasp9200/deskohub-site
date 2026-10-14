import type { Locale } from "@/features/i18n";

/** Admin-facing language names for campaign content and recipient locales. */
export const campaignLocaleNames: Record<Locale, string> = {
  "cs-CZ": "Czech",
  "en-US": "English",
};

export const describeCampaignLocales = (locales: readonly Locale[]) =>
  locales.map((locale) => campaignLocaleNames[locale]).join(", ");
