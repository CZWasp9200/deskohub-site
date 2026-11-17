import type { AppLocale } from "./app-locale";

/** A share in basis points as a percentage in the locale, such as "20%" or "20 %". */
export const formatBasisPoints = (
  basisPoints: number,
  locale: AppLocale
): string =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(basisPoints / 10_000);
