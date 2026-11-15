import {
  brandFonts,
  brandFontVariation,
  brandRadius,
} from "@deskohub/brand-tokens";
import { brandFontFamily, color } from "./ui/tokens";

type BrandWeight = (typeof brandFonts.weights)[keyof typeof brandFonts.weights];

const brandText = (weight: BrandWeight) => ({
  fontFamily: brandFontFamily,
  fontWeight: weight,
  fontVariationSettings: brandFontVariation(weight),
});

/**
 * Legacy role names for screens the design system (`ui/tokens.ts`) hasn't
 * restyled yet. The colours point at the design tokens, so those screens sit
 * on the light paper canvas with navy text; the type keeps its old sizes
 * without line heights. New code uses `ui/tokens.ts` and the `ui/`
 * components; the last screen that stops using a name here removes it.
 */
export const theme = {
  colors: {
    background: color.paper,
    text: color.navy,
    textMuted: color.ink2,
    accent: color.action,
    /** A raised area on the background, such as a group of list rows. */
    surface: color.surface,
    surfacePressed: color.pressed,
    /** Hairlines between rows and around raised areas. */
    border: color.line,
    /** Dims the screen behind a dialog. */
    scrim: color.scrim,
    danger: color.danger,
    warning: color.warningInk,
    info: color.ink2,
  },
  radius: brandRadius.px,
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  /** The smallest tappable size, in points. */
  touchTarget: 48,
  type: {
    title: { fontSize: 36, ...brandText(brandFonts.weights.heading) },
    heading: { fontSize: 22, ...brandText(brandFonts.weights.emphasis) },
    body: { fontSize: 17, ...brandText(brandFonts.weights.body) },
    bodyStrong: { fontSize: 17, ...brandText(brandFonts.weights.emphasis) },
    caption: { fontSize: 15, ...brandText(brandFonts.weights.body) },
    captionStrong: { fontSize: 15, ...brandText(brandFonts.weights.emphasis) },
  },
} as const;
