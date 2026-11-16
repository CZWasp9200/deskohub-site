import countries from "i18n-iso-countries";
import cs from "i18n-iso-countries/langs/cs.json";
import de from "i18n-iso-countries/langs/de.json";
import en from "i18n-iso-countries/langs/en.json";
import hi from "i18n-iso-countries/langs/hi.json";
import sk from "i18n-iso-countries/langs/sk.json";
import uk from "i18n-iso-countries/langs/uk.json";
import vi from "i18n-iso-countries/langs/vi.json";
import type { AppLocale } from "./app-locale";

// Hermes has no Intl.DisplayNames, so the names ship with the app.
for (const data of [cs, de, en, hi, sk, uk, vi]) countries.registerLocale(data);

/** The language each app locale's country names are in. */
const nameLanguage = {
  "en-US": "en",
  "cs-CZ": "cs",
  "de-DE": "de",
  "uk-UA": "uk",
  "sk-SK": "sk",
  "vi-VN": "vi",
  "hi-IN": "hi",
} as const satisfies Record<AppLocale, string>;

/**
 * Codes the Workspace accepts on an invoice: ISO 3166-1 alpha-2 as the
 * site's `invoiceCountryCodes` list them, which leave out the user-assigned
 * XK.
 */
const notInvoiceCountries = new Set(["XK"]);

export const invoiceCountryCodes: ReadonlyArray<string> = Object.keys(
  countries.getAlpha2Codes()
)
  .filter((code) => !notInvoiceCountries.has(code))
  .sort();

/** A country's name in the app's language, or its code when it has none. */
export const countryName = (code: string, locale: AppLocale): string =>
  countries.getName(code, nameLanguage[locale], { select: "official" }) ?? code;

export interface CountryOption {
  readonly code: string;
  readonly name: string;
}

/** Every invoice country, named and sorted in the app's language. */
export const invoiceCountries = (
  locale: AppLocale
): ReadonlyArray<CountryOption> =>
  invoiceCountryCodes
    .map((code) => ({ code, name: countryName(code, locale) }))
    .sort((left, right) => left.name.localeCompare(right.name, locale));
