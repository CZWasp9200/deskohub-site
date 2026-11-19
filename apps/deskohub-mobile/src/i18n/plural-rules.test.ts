import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { appLocales } from "./app-locale";
import { m } from "./messages";
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

describe("the app entry", () => {
  test("installs the plural rules before Expo Router loads any screen", () => {
    const entry = readFileSync(
      new URL("../../index.ts", import.meta.url),
      "utf8"
    );
    const imports = [...entry.matchAll(/^import\s+"([^"]+)";/gm)].map(
      (match) => match[1]
    );
    const pluralRules = imports.indexOf("./src/i18n/plural-rules-entry");
    expect(pluralRules).toBeGreaterThanOrEqual(0);
    expect(pluralRules).toBeLessThan(imports.indexOf("expo-router/entry"));
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

describe("plural messages on an engine without plural rules", () => {
  // Hermes has no Intl.PluralRules: with the native one removed and the
  // app's installed, every generated plural message reads as it does on ICU.
  test("read in the same forms through the app's rules", () => {
    const counts = [0, 1, 2, 3, 5, 11, 21, 22, 25, 101, 1234];
    const render = () =>
      appLocales.flatMap((locale) =>
        counts.flatMap((count) => [
          m.booking_price_line_days({ count }, { locale }),
          m.booking_office_people_count({ count }, { locale }),
          m.referrals_joined_invitees({ count }, { locale }),
          m.referrals_joined_eligible({ count }, { locale }),
        ])
      );
    const native = Intl.PluralRules;
    const onIcu = render();
    try {
      Reflect.deleteProperty(Intl, "PluralRules");
      installPluralRules();
      expect(Intl.PluralRules).not.toBe(native);
      expect(render()).toEqual(onIcu);
    } finally {
      Object.defineProperty(Intl, "PluralRules", {
        configurable: true,
        writable: true,
        value: native,
      });
    }
  });
});
