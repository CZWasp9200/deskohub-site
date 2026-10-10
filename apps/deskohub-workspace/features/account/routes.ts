import { getLocalizedPagePath, type Locale } from "@/features/i18n";

export const getAccountPath = (locale: Locale) =>
  getLocalizedPagePath(locale, "/[locale]/account");

export const getAccountSignInPath = (locale: Locale) =>
  getLocalizedPagePath(locale, "/[locale]/auth/sign-in");
