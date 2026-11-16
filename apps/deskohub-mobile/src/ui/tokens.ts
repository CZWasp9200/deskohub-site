import {
  brandColors,
  brandFontFamilies,
  brandFontVariation,
} from "@deskohub/brand-tokens";
import { Platform, type TextStyle } from "react-native";

/**
 * The app's design tokens: the colours, radii, spacing and type scale of the
 * approved foundation boards (map #1224, boards 00–00e). Components read
 * them from here; screens compose components and reach for a token only for
 * layout between them.
 */

/** Colours named for their role on screen. */
export const color = {
  /** The canvas every screen sits on (the web account canvas). */
  paper: "#F8F5EF",
  /** Cards, fields, sheets and dialogs. */
  surface: "#FFFFFF",
  /** Icon tiles, read-only fields, help boxes. */
  sunken: "#F1EDE5",
  /** Text, mastheads and the inverse surface. */
  navy: brandColors.navyBlue,
  /** Secondary text. */
  ink2: "#4A5A72",
  /** Placeholders and chevrons. */
  ink3: "#636B7E",
  /** Card outlines on the canvas. */
  line: "#E4DFD5",
  /** Dividers between rows inside a card. */
  divider: "#ECE8E0",
  /** Input outlines. */
  field: "#8C8CB0",
  /** Outline of a secondary button. */
  outline: "#C9CCDA",
  /** The primary action, focus and selection (burned orange). */
  action: brandColors.burnedOrange,
  actionPressed: "#963004",
  actionTint: "#FFF4EC",
  /** Destructive fills and field errors (crimson). */
  danger: "#C8173F",
  dangerInk: "#A3112F",
  dangerTint: "#FDECEF",
  /** Brand aquamarine: an accent on navy only, never text on light. */
  positive: brandColors.aquamarineGreen,
  positiveInk: "#00513E",
  positiveTint: "#DDF7EC",
  /** Sunset yellow: an accent only, such as an outline. */
  warning: brandColors.sunsetYellow,
  warningInk: "#6E4A00",
  warningTint: "#FDF2D9",
  /** Neutral notices and the info badge. */
  infoTint: "#ECECF7",
  /** Neutral badge text on sunken. */
  neutralInk: "#344258",
  disabled: "#E7E3DB",
  disabledInk: "#6F7484",
  /** A disabled field's fill. */
  disabledField: "#F4F2EE",
  /** A pressed row or text button on a white surface. */
  pressed: "#F6F3EE",
  /** Skeleton blocks. */
  skeleton: "#ECE7DE",
  /** Dims the screen behind a dialog or sheet. */
  scrim: "rgba(0, 2, 79, 0.48)",
  /** Supporting text on navy. */
  onNavyMuted: "#C9CCE6",
  /** A toast's action on navy or green. */
  toastAction: "#FFC86B",
  /** The grab handle of a bottom sheet. */
  handle: "#C9CCDA",
  /** The dashed outline of an empty state. */
  dashed: "#D3CDC0",
  /** The one-tone line drawings on paper, such as the sign-in shield. */
  illustration: "#B5B0A6",
  white: "#FFFFFF",
} as const;

/** Corner radii. */
export const radius = {
  /** Checkboxes. */
  checkbox: 6,
  /** Icon tiles and code boxes. */
  tile: 12,
  /** Badges. */
  badge: 12,
  /** Fields, choice cards, notices, toasts. */
  field: 14,
  /** Grouped rows and section cards. */
  group: 16,
  /** Standalone content cards. */
  card: 20,
  /** Empty-state discs. */
  disc: 20,
  /** Dialogs and the top corners of a bottom sheet. */
  overlay: 28,
  /** Buttons and switches. */
  pill: 999,
} as const;

/** Spacing steps; `gutter` is the one left edge all content shares. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  gutter: 16,
} as const;

/** The smallest tappable size. */
export const touchTarget = 48;

/** Shadows, as React Native style fragments (Android uses `elevation`). */
export const shadow = {
  /** Grouped rows: the outline plus a hairline drop. */
  group: {
    boxShadow: "0 1px 2px rgba(0, 2, 79, 0.04)",
  },
  /** A standalone card. */
  card: {
    boxShadow: "0 12px 28px -18px rgba(0, 2, 79, 0.35)",
  },
  /** Primary button lighting. */
  primary: {
    boxShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 6px 14px -8px rgba(150, 48, 4, 0.7)",
  },
  danger: {
    boxShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 6px 14px -8px rgba(163, 17, 47, 0.7)",
  },
  dialog: { boxShadow: "0 24px 48px -12px rgba(0, 2, 79, 0.45)" },
  sheet: { boxShadow: "0 -12px 32px -12px rgba(0, 2, 79, 0.35)" },
  toast: { boxShadow: "0 10px 24px -8px rgba(0, 2, 79, 0.5)" },
  toastConfirmation: { boxShadow: "0 10px 24px -8px rgba(0, 81, 62, 0.55)" },
  /** The pull-to-refresh disc. */
  refresh: { boxShadow: "0 2px 8px rgba(0, 2, 79, 0.25)" },
} as const;

/** The brand face's family name on this platform. */
export const brandFontFamily = Platform.select({
  web: brandFontFamilies.web,
  default: brandFontFamilies.native,
});

/** Every weight the type scale draws; each needs a registered native face. */
export const fontWeights = [400, 500, 600, 700] as const;

type Weight = (typeof fontWeights)[number];

/**
 * A text style in the brand face at a size and weight off the type scale,
 * such as a date tile's figures; prefer a `typeScale` entry.
 */
export const brandText = (
  fontSize: number,
  lineHeight: number,
  weight: Weight,
  letterSpacing = 0
) =>
  ({
    fontFamily: brandFontFamily,
    fontSize,
    lineHeight,
    fontWeight: String(weight) as TextStyle["fontWeight"],
    // Sculpin is a variable face whose default weight is 300: pin the axis.
    fontVariationSettings: brandFontVariation(weight),
    letterSpacing,
  }) satisfies TextStyle;

/** The type scale, in the brand face with line heights set. */
export const typeScale = {
  /** Tab root titles in the masthead. */
  display: brandText(32, 38, 700, -0.5),
  /** Screen hero titles and step titles. */
  titleLarge: brandText(26, 32, 700, -0.3),
  /** App bar, dialog and empty-state titles. */
  title: brandText(20, 28, 600),
  /** Card titles. */
  headline: brandText(17, 24, 600),
  /** Field values and running text. */
  body: brandText(16, 24, 400),
  /** Row and choice titles. */
  bodyStrong: brandText(16, 22, 600),
  /** Dialog bodies and masthead subtitles. */
  lead: brandText(15, 22, 400),
  /** Section headers and notice titles. */
  subhead: brandText(15, 20, 600),
  /** A list row's value beside its label. */
  rowValue: brandText(15, 24, 400),
  /** Supporting text and row descriptions. */
  bodySmall: brandText(14, 20, 400),
  /** Field labels. */
  label: brandText(14, 20, 600),
  /** Step counters and helper lines. */
  hint: brandText(13, 18, 400),
  /** Field errors and a footer's error message. */
  hintStrong: brandText(13, 18, 500),
  /** Counters and helper captions. */
  caption: brandText(12, 16, 500),
  /** Badge labels. */
  badge: brandText(12, 16, 600),
  /** Button labels. */
  button: brandText(16, 20, 600),
  /** Small button labels. */
  buttonSmall: brandText(14, 20, 600),
  /** Dialog titles. */
  dialogTitle: brandText(22, 28, 700),
} as const;

export type TypeVariant = keyof typeof typeScale;
