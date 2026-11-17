import { foldSearchText } from "@deskohub/i18n/search-text";
import { type CountryOption, homeCountry } from "../i18n/country-names";

/** Deskohub's neighbours, which customers pick most after Czechia (board 07b). */
const neighbourCountries = ["SK", "DE", "AT", "PL", "UA"] as const;

// A name's words: what follows a space or punctuation, as in "Guinea-Bissau".
const startsAWord = (name: string, search: string) =>
  name.split(/[\s\p{P}]+/u).some((word) => word.startsWith(search));

/**
 * The countries the country picker lists, in order. `countries` is every
 * invoice country, sorted by name in the app's language.
 *
 * Without a search, the chosen country comes first, then the device's
 * country, Czechia and its neighbours, then every other country in the
 * order given. With one, the countries whose name contains it, ignoring
 * case and accents: names with a word starting with it first, each part in
 * the order given.
 */
export const countryPickerOptions = ({
  countries,
  query,
  value,
  detected,
}: {
  readonly countries: ReadonlyArray<CountryOption>;
  readonly query: string;
  /** The chosen country's code; empty while none is chosen. */
  readonly value: string;
  /** The device's country (`detectedCountry`). */
  readonly detected: string;
}): ReadonlyArray<CountryOption> => {
  const search = foldSearchText(query.trim());
  if (search === "") {
    const byCode = new Map(countries.map((country) => [country.code, country]));
    const suggested = [
      ...new Set([value, detected, homeCountry, ...neighbourCountries]),
    ].flatMap((code) => byCode.get(code) ?? []);
    const first = new Set(suggested.map(({ code }) => code));
    return [...suggested, ...countries.filter(({ code }) => !first.has(code))];
  }
  const wordStarts: Array<CountryOption> = [];
  const contains: Array<CountryOption> = [];
  for (const country of countries) {
    const name = foldSearchText(country.name);
    if (startsAWord(name, search)) wordStarts.push(country);
    else if (name.includes(search)) contains.push(country);
  }
  return [...wordStarts, ...contains];
};
