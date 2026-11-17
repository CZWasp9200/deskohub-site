import { describe, expect, test } from "bun:test";
import { appLocales } from "./app-locale";
import { AppPluralRules, installPluralRules } from "./plural-rules";

// Integers past the hundreds where Ukrainian's 11–14 exceptions repeat,
// fractions, and negatives: what a count or an amount can be.
const values = [
  ...Array.from({ length: 1201 }, (_, index) => index),
  0.5,
  1.5,
  2.25,
  4.1,
  5.75,
  11.5,
  21.25,
  -1,
  -2,
  -5,
  -21,
];

describe.each([...appLocales])("the %s plural rules", (locale) => {
  const icu = new Intl.PluralRules(locale);
  const app = new AppPluralRules(locale);

  test("select the category ICU selects", () => {
    const differing = values.filter(
      (value) => app.select(value) !== icu.select(value)
    );
    expect(differing).toEqual([]);
  });

  test("have ICU's categories", () => {
    expect(app.resolvedOptions().pluralCategories).toEqual(
      icu.resolvedOptions().pluralCategories
    );
  });
});

describe("the app plural rules", () => {
  test("read a locale the app doesn't serve as the app's locale for it", () => {
    expect(new AppPluralRules("cs").resolvedOptions().locale).toBe("cs-CZ");
    expect(new AppPluralRules(["fr-FR"]).resolvedOptions().locale).toBe(
      "en-US"
    );
  });

  test("select other for a value that is not finite", () => {
    expect(new AppPluralRules("cs-CZ").select(Number.NaN)).toBe("other");
  });

  test("refuse ordinal rules", () => {
    expect(() => new AppPluralRules("en-US", { type: "ordinal" })).toThrow(
      RangeError
    );
  });
});

describe("installPluralRules", () => {
  test("gives an engine without plural rules the app's", () => {
    const intl = {} as typeof Intl;
    installPluralRules(intl);
    expect(new intl.PluralRules("cs-CZ").select(3)).toBe("few");
  });

  test("keeps an engine's own plural rules", () => {
    const intl = { PluralRules: Intl.PluralRules } as typeof Intl;
    installPluralRules(intl);
    expect(intl.PluralRules).toBe(Intl.PluralRules);
  });
});
