import type { ComponentProps } from "react";
import {
  // biome-ignore lint/style/noRestrictedImports: the app's Text wraps it
  Text as NativeText,
  // biome-ignore lint/style/noRestrictedImports: the app's TextInput wraps it
  TextInput as NativeTextInput,
} from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { useProvidedAppLocale } from "../i18n/locale-context";
import { localeTextStyle, textFontFamily } from "./text-style";
import { color, type TypeVariant, typeScale } from "./tokens";

/** What text says about itself through colour. */
type TextTone =
  | "default"
  | "muted"
  | "subtle"
  | "action"
  | "danger"
  | "positive"
  | "warning"
  | "inverse";

const toneColor = {
  default: color.navy,
  muted: color.ink2,
  subtle: color.ink3,
  action: color.action,
  danger: color.dangerInk,
  positive: color.positiveInk,
  warning: color.warningInk,
  inverse: color.white,
} as const satisfies Record<TextTone, string>;

type TextProps = ComponentProps<typeof NativeText> & {
  /** The language the text is in when it isn't the app's, such as a language's own name. */
  readonly locale?: AppLocale;
  /**
   * The step of the type scale (`ui/tokens.ts`). Without it the text keeps
   * only the caller's `style`, as screens not yet restyled expect.
   */
  readonly variant?: TypeVariant;
  /** The text colour by role; supporting variants default to `muted`. */
  readonly tone?: TextTone;
  /** Tabular figures, so digits line up and don't shift as they change. */
  readonly numeric?: boolean;
};

const mutedByDefault: ReadonlySet<TypeVariant> = new Set(["bodySmall", "hint"]);

/**
 * React Native's Text, set in the font for the script of the app's locale
 * (or of `locale`): see `localeTextStyle`. Style the app's text through it;
 * React Native's own is banned by lint. A `variant` draws a step of the type
 * scale in a `tone`; the caller's `style` still wins.
 */
export function Text({
  locale,
  style,
  variant,
  tone,
  numeric = false,
  ...props
}: TextProps) {
  const appLocale = useProvidedAppLocale();
  const scaled = variant && [
    typeScale[variant],
    {
      color:
        toneColor[tone ?? (mutedByDefault.has(variant) ? "muted" : "default")],
    },
  ];
  const toned = !variant && tone && { color: toneColor[tone] };
  const styled =
    scaled || toned || numeric
      ? [
          scaled,
          toned,
          numeric && { fontVariant: ["tabular-nums" as const] },
          style,
        ]
      : style;
  return (
    <NativeText
      {...props}
      style={localeTextStyle(styled, locale ?? appLocale)}
    />
  );
}

/**
 * React Native's TextInput, set in the font for the script of the app's
 * locale (see `localeTextStyle`). A change of font remounts the input:
 * Android keeps a mounted input's family when the style drops it.
 */
export function TextInput({
  style,
  ...props
}: ComponentProps<typeof NativeTextInput>) {
  const locale = useProvidedAppLocale();
  return (
    <NativeTextInput
      {...props}
      key={
        locale === undefined ? "default" : (textFontFamily(locale) ?? "system")
      }
      style={localeTextStyle(style, locale)}
    />
  );
}
