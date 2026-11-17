import { describe, expect, test } from "bun:test";
import { appLocales } from "./app-locale";
import {
  bundledCountryName,
  countryName,
  detectedCountry,
  homeCountry,
  invoiceCountries,
  invoiceCountryCodes,
} from "./country-names";

describe("invoice countries", () => {
  test("offer the ISO codes the Workspace accepts on an invoice", () => {
    expect(invoiceCountryCodes).toContain("CZ");
    expect(invoiceCountryCodes).not.toContain("XK");
    expect(invoiceCountryCodes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(
      true
    );
    // country-list's ISO 3166-1 alpha-2 set, as the site validates it.
    expect(invoiceCountryCodes).toHaveLength(249);
  });

  test("every app locale names every country", () => {
    for (const locale of appLocales) {
      const countries = invoiceCountries(locale);
      expect(countries).toHaveLength(invoiceCountryCodes.length);
      expect(countries.filter(({ name, code }) => name === code)).toEqual([]);
    }
  });

  test("names follow the app's language, sorted in it", () => {
    expect(countryName("DE", "cs-CZ")).not.toBe(countryName("DE", "en-US"));
    const names = invoiceCountries("cs-CZ").map(({ name }) => name);
    expect(names).toEqual(
      [...names].sort((left, right) => left.localeCompare(right, "cs-CZ"))
    );
  });

  test("without Intl.DisplayNames, the home country keeps the website's short name", () => {
    for (const locale of appLocales) {
      expect(bundledCountryName("CZ", locale)).toBe(
        new Intl.DisplayNames([locale], { type: "region" }).of("CZ") ?? ""
      );
    }
  });
});

describe("detectedCountry", () => {
  test("is the first device region that is an invoice country", () => {
    expect(detectedCountry(["US", "DE"])).toBe("US");
    expect(detectedCountry([null, "XK", "at"])).toBe("AT");
  });

  test("falls back to the home country when no region is one", () => {
    expect(detectedCountry([])).toBe(homeCountry);
    expect(detectedCountry([null, undefined, "XK", "419"])).toBe(homeCountry);
    expect(homeCountry).toBe("CZ");
  });
});
