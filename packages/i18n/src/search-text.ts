/**
 * Text as a search compares it: lower-cased without accents, so "Výprodej"
 * and "vyprodej", or "Česko" and "cesko", compare equal.
 */
export const foldSearchText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Whether `text` contains `search`, ignoring case, accents and the search's outer spaces. */
export const includesSearchText = (text: string, search: string) =>
  foldSearchText(text).includes(foldSearchText(search.trim()));
