import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { isLocale, type Locale } from "../paraglide/runtime.js";
import { requestLocaleScope } from "./request-locale-scope";

export async function getRequestLocale() {
  const locale = await rootLocale();
  if (!isLocale(locale)) notFound();

  return locale;
}

export async function runWithRequestLocale<T>(
  resolve: (locale: Locale) => T | Promise<T>
) {
  const locale = await getRequestLocale();

  return requestLocaleScope.runWithLocale(locale, () => resolve(locale));
}
