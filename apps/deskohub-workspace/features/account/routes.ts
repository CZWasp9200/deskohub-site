import type { Locale } from "@/features/i18n";

export const getAccountPath = (locale: Locale) => `/${locale}/account`;

export const getAccountSignInPath = (locale: Locale) =>
  `/${locale}/auth/sign-in`;
