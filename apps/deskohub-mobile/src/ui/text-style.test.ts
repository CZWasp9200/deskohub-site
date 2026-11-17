import { describe, expect, test } from "bun:test";
import {
  brandFontFamilies,
  brandFonts,
  brandFontVariation,
} from "@deskohub/brand-tokens";
import { localeTextStyle, textFontFamily } from "./text-style";
import { color, typeScale } from "./tokens";

describe("textFontFamily", () => {
  test("sets Latin-script locales in the brand face", () => {
    for (const locale of ["en-US", "cs-CZ", "de-DE", "sk-SK"] as const) {
      expect(textFontFamily(locale)).toBe(brandFontFamilies.native);
    }
  });

  test("sets other scripts in the system font", () => {
    // The brand face lacks Cyrillic, Devanagari and Vietnamese's stacked
    // diacritics.
    for (const locale of ["uk-UA", "vi-VN", "hi-IN"] as const) {
      expect(textFontFamily(locale)).toBeUndefined();
    }
  });
});

describe("localeTextStyle", () => {
  const body = { ...typeScale.bodyStrong, color: color.navy };

  test("keeps a style as it is for a Latin-script locale", () => {
    expect(localeTextStyle(body, "de-DE")).toBe(body);
  });

  test("drops the brand face and its weight axis for another script", () => {
    expect(localeTextStyle([body, false, [{ marginTop: 4 }]], "uk-UA")).toEqual(
      {
        color: color.navy,
        fontSize: typeScale.bodyStrong.fontSize,
        fontWeight: typeScale.bodyStrong.fontWeight,
        marginTop: 4,
      }
    );
  });

  test("leaves the brand face's line height and tracking out of the system font", () => {
    const style = localeTextStyle(typeScale.display, "hi-IN");
    expect(style).not.toHaveProperty("lineHeight");
    expect(style).not.toHaveProperty("letterSpacing");
    expect(style).toHaveProperty("fontSize", typeScale.display.fontSize);
  });

  test("keeps a style as it is without a locale", () => {
    expect(localeTextStyle(body, undefined)).toBe(body);
  });

  test("leaves the brand face's own variation out of the system font", () => {
    const style = localeTextStyle(body, "uk-UA");
    expect(style).not.toHaveProperty("fontVariationSettings");
    expect(body.fontVariationSettings).toBe(
      brandFontVariation(brandFonts.weights.emphasis)
    );
  });
});
