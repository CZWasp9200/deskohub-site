import { getLocaleDefinition } from "@deskohub/i18n/locale-registry";
import { type StyleProp, StyleSheet, type TextStyle } from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { brandFontFamily } from "./tokens";

const setsBrandFace = (locale: AppLocale) =>
  getLocaleDefinition(locale).script === "latin";

/**
 * The family text in `locale` is set in: the brand face, which has only
 * Latin glyphs and lacks Vietnamese's stacked diacritics, for a Latin-script
 * locale; the system font (no family) otherwise.
 */
export const textFontFamily = (locale: AppLocale): string | undefined =>
  setsBrandFace(locale) ? brandFontFamily : undefined;

/**
 * `style` for text in `locale`. The type scale names the brand face; for a
 * script it doesn't cover the style loses the family, the brand face's
 * weight axis, its line height and its tracking, so the system font draws
 * the text at the same size and weight with its own metrics, which leave
 * room for Devanagari's and Vietnamese's marks above and below. Without a
 * locale the style stays as it is.
 */
export const localeTextStyle = <Style extends StyleProp<TextStyle>>(
  style: Style,
  locale: AppLocale | undefined
): Style | TextStyle => {
  if (locale === undefined || setsBrandFace(locale)) return style;
  const {
    fontFamily: _family,
    fontVariationSettings: _variation,
    lineHeight: _lineHeight,
    letterSpacing: _letterSpacing,
    ...systemStyle
  } = StyleSheet.flatten(style) ?? {};
  return systemStyle;
};
