import { replaceLocaleInPathname } from "@deskohub/i18n/pathname";
import { Predicate } from "effect";
import type { AppRoutes } from "@/.next/types/routes";
import {
  baseLocale,
  cookieName,
  type Locale,
  locales,
} from "./paraglide/runtime.js";

export { locales };

export const defaultLocale: Locale = baseLocale;

export const localeCookieName = cookieName;

export const localeConfig = {
  locales,
  baseLocale: defaultLocale,
  preferredLanguageToLocale: {
    cs: "cs-CZ",
    en: "en-US",
  },
} as const;

const withLocalePrefix = (pathname: string, locale: Locale): string =>
  replaceLocaleInPathname(pathname, locale, locales);

const localeRouteSegment = "/[locale]";

type StaticLocalizedPageRoute = Exclude<
  Extract<AppRoutes, `${typeof localeRouteSegment}/${string}`>,
  `${typeof localeRouteSegment}/${string}[${string}`
>;

/**
 * Builds a localized page path from a route Next generated from the app
 * directory, so typecheck proves the page exists.
 */
export const getLocalizedPagePath = (
  locale: Locale,
  route: StaticLocalizedPageRoute
): string => `/${locale}${route.slice(localeRouteSegment.length)}`;

export const withLocalePrefixAndSearch = (
  pathname: string,
  locale: Locale,
  searchParams: Pick<URLSearchParams, "toString"> | string
): string => {
  const localizedPathname = withLocalePrefix(pathname, locale);
  const rawSearchString = Predicate.isString(searchParams)
    ? searchParams
    : searchParams.toString();
  const searchString = rawSearchString.startsWith("?")
    ? rawSearchString.slice(1)
    : rawSearchString;

  if (!searchString) {
    return localizedPathname;
  }

  return `${localizedPathname}?${searchString}`;
};
