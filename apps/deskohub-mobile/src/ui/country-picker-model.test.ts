import { describe, expect, test } from "bun:test";
import { invoiceCountries, invoiceCountryCodes } from "../i18n/country-names";
import { countryPickerOptions } from "./country-picker-model";

const codes = (options: ReadonlyArray<{ readonly code: string }>) =>
  options.map(({ code }) => code);

describe("countryPickerOptions without a search", () => {
  const countries = invoiceCountries("en-US");

  test("start with the chosen country, then Czechia and its neighbours, then the rest in order", () => {
    const options = countryPickerOptions({
      countries,
      query: "",
      value: "CZ",
      detected: "CZ",
    });
    expect(codes(options).slice(0, 6)).toEqual([
      "CZ",
      "SK",
      "DE",
      "AT",
      "PL",
      "UA",
    ]);
    const suggested = new Set(codes(options).slice(0, 6));
    expect(codes(options).slice(6)).toEqual(
      codes(countries).filter((code) => !suggested.has(code))
    );
    expect(new Set(codes(options)).size).toBe(invoiceCountryCodes.length);
  });

  test("put the chosen country, then the device's, before the neighbours", () => {
    const options = countryPickerOptions({
      countries,
      query: " ",
      value: "FR",
      detected: "US",
    });
    expect(codes(options).slice(0, 8)).toEqual([
      "FR",
      "US",
      "CZ",
      "SK",
      "DE",
      "AT",
      "PL",
      "UA",
    ]);
  });

  test("skip a blank or unknown chosen country and repeat none", () => {
    for (const value of ["", "XK"]) {
      const options = countryPickerOptions({
        countries,
        query: "",
        value,
        detected: "DE",
      });
      expect(codes(options).slice(0, 6)).toEqual([
        "DE",
        "CZ",
        "SK",
        "AT",
        "PL",
        "UA",
      ]);
      expect(options).toHaveLength(invoiceCountryCodes.length);
    }
  });
});

describe("countryPickerOptions with a search", () => {
  // Names as a locale might give them, sorted as the picker receives them.
  const countries = [
    { code: "AF", name: "Afghanistan" },
    { code: "AD", name: "Andorra" },
    { code: "BA", name: "Bosnia and Herzegovina" },
    { code: "CZ", name: "Česko" },
    { code: "GW", name: "Guinea-Bissau" },
    { code: "JP", name: "Japan" },
    { code: "PE", name: "Peru" },
  ];
  const search = (query: string) =>
    codes(
      countryPickerOptions({ countries, query, value: "PE", detected: "CZ" })
    );

  test("list names with a word starting with it first, then other names containing it", () => {
    expect(search("an")).toEqual(["AD", "BA", "AF", "JP"]);
    expect(search("biss")).toEqual(["GW"]);
  });

  test("ignore case, accents and outer spaces", () => {
    expect(search("  CESKO ")).toEqual(["CZ"]);
    expect(search("česk")).toEqual(["CZ"]);
  });

  test("list nothing when no name contains it", () => {
    expect(search("xyz")).toEqual([]);
  });
});
