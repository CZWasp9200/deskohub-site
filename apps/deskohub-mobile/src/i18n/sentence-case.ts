/**
 * `text` with its first letter in the locale's upper case, such as a
 * formatted month name or a list of extras that starts a line.
 */
export const upperFirst = (text: string, locale: string): string =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
