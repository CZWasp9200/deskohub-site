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

/**
 * The short names the website shows (CLDR, through `Intl.DisplayNames`) where
 * the bundled list has only a long official one: the app's home country,
 * which most customers pick, reads "Czechia", not "Czech Republic".
 */
const shortNames: Readonly<
  Record<string, Readonly<Record<AppLocale, string>>>
> = {
  CZ: {
    "en-US": "Czechia",
    "cs-CZ": "Česko",
    "de-DE": "Tschechien",
    "sk-SK": "Česko",
    "uk-UA": "Чехія",
    "vi-VN": "Séc",
    "hi-IN": "चेकिया",
  },
};

/**
 * A country's name from the bundled list, for engines without
 * `Intl.DisplayNames` (Hermes), or its code when it has none.
 */
export const bundledCountryName = (code: string, locale: AppLocale): string =>
  shortNames[code]?.[locale] ??
  countries.getName(code, nameLanguage[locale], { select: "official" }) ??
  code;

const regionNames = new Map<AppLocale, Intl.DisplayNames | undefined>();
const regionNamesOf = (locale: AppLocale) => {
  if (!regionNames.has(locale)) {
    let names: Intl.DisplayNames | undefined;
    try {
      names =
        typeof Intl.DisplayNames === "function"
          ? new Intl.DisplayNames([locale], { type: "region" })
          : undefined;
    } catch {
      names = undefined;
    }
    regionNames.set(locale, names);
  }
  return regionNames.get(locale);
};

/**
 * A country's name in the app's language, as the website names it where the
 * engine can (`Intl.DisplayNames`), else from the bundled list.
 */
export const countryName = (code: string, locale: AppLocale): string => {
  const shown = regionNamesOf(locale)?.of(code);
  return shown === undefined || shown === code
    ? bundledCountryName(code, locale)
    : shown;
};

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

/** Deskohub's own country: where a new address starts when the device names none. */
export const homeCountry = "CZ";

/**
 * The country a new address starts with: the first of the device's regions
 * (its language preferences' regions, in order, such as `US` for en-US) that
 * takes invoices, else the home country.
 */
export const detectedCountry = (
  regions: ReadonlyArray<string | null | undefined>
): string =>
  regions
    .map((region) => region?.toUpperCase())
    .find(
      (code): code is string =>
        code !== undefined && invoiceCountryCodes.includes(code)
    ) ?? homeCountry;
