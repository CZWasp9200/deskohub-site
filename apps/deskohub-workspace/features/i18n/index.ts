export { m } from "./paraglide/messages.js";
export {
  baseLocale,
  getLocale,
  isLocale,
  type Locale,
  locales,
  setLocale,
} from "./paraglide/runtime.js";
export {
  defaultLocale,
  getLocaleFromPathname,
  getLocalizedPagePath,
  getPreferredLocaleFromAcceptLanguage,
  localeConfig,
  localeCookieName,
  resolveLocaleFromPolicy,
  withLocalePrefix,
  withLocalePrefixAndSearch,
} from "./routing";
