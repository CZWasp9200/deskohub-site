import { type AppLocale, resolveAppLocale } from "./app-locale";

/**
 * The CLDR operands a cardinal rule reads: `n` the absolute value, `i` its
 * integer digits and `v` the count of its visible fraction digits.
 */
interface PluralOperands {
  readonly n: number;
  readonly i: number;
  readonly v: number;
}

const operandsOf = (value: number): PluralOperands => {
  const n = Math.abs(value);
  const text = String(n);
  const fraction = text.includes("e") ? "" : (text.split(".")[1] ?? "");
  return { n, i: Math.trunc(n), v: fraction.length };
};

type CardinalRule = (operands: PluralOperands) => Intl.LDMLPluralRule;

/** Czech and Slovak share a rule: `many` is for fractions. */
const westSlavic: CardinalRule = ({ i, v }) => {
  if (v !== 0) return "many";
  if (i === 1) return "one";
  if (i >= 2 && i <= 4) return "few";
  return "other";
};

const germanic: CardinalRule = ({ i, v }) =>
  i === 1 && v === 0 ? "one" : "other";

const ukrainian: CardinalRule = ({ i, v }) => {
  if (v !== 0) return "other";
  const lastDigit = i % 10;
  const lastTwo = i % 100;
  if (lastDigit === 1 && lastTwo !== 11) return "one";
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return "few";
  }
  return "many";
};

/**
 * Each app locale's CLDR cardinal rule with its categories, written out
 * because Hermes ships no `Intl.PluralRules` and the formatjs polyfill needs
 * an `Intl.Locale` polyfill too. `plural-rules.test.ts` holds them to ICU.
 */
const cardinalRules: Record<
  AppLocale,
  {
    readonly select: CardinalRule;
    readonly categories: ReadonlyArray<Intl.LDMLPluralRule>;
  }
> = {
  "en-US": { select: germanic, categories: ["one", "other"] },
  "cs-CZ": { select: westSlavic, categories: ["one", "few", "many", "other"] },
  "de-DE": { select: germanic, categories: ["one", "other"] },
  "uk-UA": { select: ukrainian, categories: ["one", "few", "many", "other"] },
  "sk-SK": { select: westSlavic, categories: ["one", "few", "many", "other"] },
  "vi-VN": { select: () => "other", categories: ["other"] },
  "hi-IN": {
    select: ({ n, i }) => (i === 0 || n === 1 ? "one" : "other"),
    categories: ["one", "other"],
  },
};

/**
 * `Intl.PluralRules` for the app's locales, cardinal only: what Paraglide's
 * plural messages call. A locale the app doesn't serve reads like the app's
 * locale for it (`resolveAppLocale`), and number-format options are ignored,
 * so a number selects by the digits it has.
 */
export class AppPluralRules {
  readonly #locale: AppLocale;

  constructor(
    locales?: string | ReadonlyArray<string>,
    options?: Intl.PluralRulesOptions
  ) {
    if (options?.type === "ordinal") {
      throw new RangeError("The app's plural rules are cardinal only");
    }
    this.#locale = resolveAppLocale(
      typeof locales === "string" ? [locales] : (locales ?? [])
    );
  }

  select(value: number): Intl.LDMLPluralRule {
    return Number.isFinite(value)
      ? cardinalRules[this.#locale].select(operandsOf(value))
      : "other";
  }

  resolvedOptions(): {
    readonly locale: AppLocale;
    readonly type: "cardinal";
    readonly pluralCategories: ReadonlyArray<Intl.LDMLPluralRule>;
  } {
    return {
      locale: this.#locale,
      type: "cardinal",
      pluralCategories: cardinalRules[this.#locale].categories,
    };
  }
}

/**
 * Gives an engine without `Intl.PluralRules` (Hermes) the app's, so plural
 * messages choose their forms on a device; an engine with its own keeps it.
 */
export const installPluralRules = (intl: typeof Intl = Intl): void => {
  if (typeof intl.PluralRules === "function") return;
  Object.defineProperty(intl, "PluralRules", {
    configurable: true,
    writable: true,
    value: AppPluralRules,
  });
};
