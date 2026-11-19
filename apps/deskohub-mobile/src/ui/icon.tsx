import type { ComponentType } from "react";
import { Platform } from "react-native";
import { color as palette } from "./tokens";

/**
 * An icon a component can draw: a Lucide icon, imported by the caller from
 * its own entry (`import Mail from "lucide-react-native/icons/mail"`).
 */
export type IconComponent = ComponentType<{
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly "aria-hidden"?: boolean;
  readonly accessible?: boolean;
  readonly accessibilityElementsHidden?: boolean;
  readonly importantForAccessibility?: "no-hide-descendants";
}>;

/**
 * The icon sizes the design uses, in dp; 36 is the success mark of a
 * received withdrawal.
 */
export type IconSize = 14 | 16 | 18 | 20 | 22 | 24 | 26 | 28 | 30 | 32 | 36;

/**
 * A Lucide icon at a design size, stroke 2, in `color` (navy by default).
 * Icons are decorative: the control or text beside one carries its meaning,
 * so the icon is hidden from assistive technology.
 */
/**
 * The props that hide an icon from assistive technology on `os`. The web's
 * SVG element takes ARIA; native views take React Native's own props, which
 * the DOM would reject as unknown attributes (React warns, and Expo's web
 * development build shows its error overlay).
 */
export const iconHiddenProps = (os: string) =>
  os === "web"
    ? ({ "aria-hidden": true } as const)
    : ({
        accessible: false,
        accessibilityElementsHidden: true,
        importantForAccessibility: "no-hide-descendants",
      } as const);

export function Icon({
  icon: Glyph,
  size = 24,
  color = palette.navy,
}: {
  readonly icon: IconComponent;
  readonly size?: IconSize;
  readonly color?: string;
}) {
  return (
    <Glyph
      size={size}
      color={color}
      strokeWidth={2}
      {...iconHiddenProps(Platform.OS)}
    />
  );
}
