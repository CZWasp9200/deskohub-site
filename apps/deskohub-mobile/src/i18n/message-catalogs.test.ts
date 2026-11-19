import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import inlangSettings from "../../project.inlang/settings.json" with {
  type: "json",
};
import { isAppLocale } from "./app-locale";
import { AppPluralRules } from "./plural-rules";

const projectRoot = new URL("../../", import.meta.url);
const catalogPaths = inlangSettings["plugin.inlang.messageFormat"].pathPattern;

const readCatalog = (locale: string): Record<string, unknown> =>
  Object.assign(
    {},
    ...catalogPaths.map((pattern) =>
      JSON.parse(
        readFileSync(
          new URL(pattern.replace("{languageTag}", locale), projectRoot),
          "utf8"
        )
      )
    )
  );

/** A message with variants, such as a plural, as Inlang stores it. */
interface VariantMessage {
  readonly declarations: ReadonlyArray<string>;
  readonly selectors: ReadonlyArray<string>;
  readonly match: Readonly<Record<string, string>>;
}

const variantsOf = (message: unknown): VariantMessage | undefined =>
  Array.isArray(message) && message.length === 1
    ? (message[0] as VariantMessage)
    : undefined;

/** The texts a message can render: itself, or each of its variants. */
const textsOf = (message: unknown): ReadonlyArray<unknown> => {
  if (typeof message === "string") return [message];
  const variants = variantsOf(message);
  return variants === undefined ? [message] : Object.values(variants.match);
};

const placeholdersOf = (message: unknown): ReadonlyArray<string> =>
  Array.from(
    new Set(
      textsOf(message).flatMap((text) =>
        typeof text === "string"
          ? Array.from(text.matchAll(/\{([^{}]+)\}/g), ([, name]) => name ?? "")
          : []
      )
    )
  ).sort();

/** The plural categories a whole count can select in a locale. */
const wholeCountCategories = (locale: string): ReadonlyArray<string> => {
  const rules = new AppPluralRules(locale);
  return Array.from(
    new Set(Array.from({ length: 200 }, (_, count) => rules.select(count)))
  );
};

const baseCatalog = readCatalog(inlangSettings.baseLocale);

// Every catalog carries the base catalog's messages in its order, so a
// translator's file reads side by side with the base, and each message keeps
// the base's placeholders, so the same call fills every locale.
describe.each(
  inlangSettings.locales.filter(
    (locale) => locale !== inlangSettings.baseLocale
  )
)("the %s message catalog", (locale) => {
  test("has the base catalog's keys in the same order", () => {
    expect(Object.keys(readCatalog(locale))).toEqual(Object.keys(baseCatalog));
  });

  test("keeps each message's placeholders", () => {
    const catalog = readCatalog(locale);
    for (const [key, baseMessage] of Object.entries(baseCatalog)) {
      const message = catalog[key];
      expect({ key, placeholders: placeholdersOf(message) }).toEqual({
        key,
        placeholders: placeholdersOf(baseMessage),
      });
    }
  });
});

describe.each(inlangSettings.locales)("the %s message catalog", (locale) => {
  test("has a non-empty text for every message", () => {
    const blank = Object.entries(readCatalog(locale))
      .filter(([, message]) =>
        textsOf(message).some(
          (text) => typeof text !== "string" || text.trim() === ""
        )
      )
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });

  // Each plural message has a form for every whole count, so Paraglide never
  // falls through to the message key, and only the locale's categories.
  test("gives each plural message a form for every whole count", () => {
    if (!isAppLocale(locale)) throw new Error(`${locale} is no app locale`);
    const whole = wholeCountCategories(locale);
    const known = new AppPluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, message] of Object.entries(readCatalog(locale))) {
      const variants = variantsOf(message);
      if (variants === undefined) continue;
      const categories = Object.keys(variants.match).map((match) =>
        match.replace(/^countPlural=/, "")
      );
      expect({
        key,
        missing: whole.filter((category) => !categories.includes(category)),
        unknown: categories.filter(
          (category) =>
            category !== "*" && !known.includes(category as Intl.LDMLPluralRule)
        ),
      }).toEqual({ key, missing: [], unknown: [] });
    }
  });
});
