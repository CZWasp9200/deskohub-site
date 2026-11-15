import type { ComponentType } from "react";
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
  readonly importantForAccessibility?: "no-hide-descendants";
}>;

/** The icon sizes the design uses, in dp. */
export type IconSize = 14 | 16 | 18 | 20 | 24 | 26 | 28 | 30 | 32;

/**
 * A Lucide icon at a design size, stroke 2, in `color` (navy by default).
 * Icons are decorative: the control or text beside one carries its meaning,
 * so the icon is hidden from assistive technology.
 */
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
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}
