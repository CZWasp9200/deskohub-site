import { StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "./icon";
import { Text } from "./text";
import { color, radius, space } from "./tokens";

/** What a badge says about its subject. */
export type BadgeTone = "positive" | "neutral" | "warning" | "danger" | "info";

const badgeColors = {
  positive: { background: color.positiveTint, ink: color.positiveInk },
  neutral: { background: color.sunken, ink: color.neutralInk },
  warning: { background: color.warningTint, ink: color.warningInk },
  danger: { background: color.dangerTint, ink: color.dangerInk },
  info: { background: color.infoTint, ink: color.navy },
} as const satisfies Record<
  BadgeTone,
  { readonly background: string; readonly ink: string }
>;

/**
 * A status label in a tinted pill, such as a reservation's state. It is
 * static text and never looks like a control; it grows with the text
 * instead of cutting it.
 */
export function Badge({
  label,
  tone,
  icon,
}: {
  readonly label: string;
  readonly tone: BadgeTone;
  /** A Lucide icon before the label. */
  readonly icon?: IconComponent;
}) {
  const { background, ink } = badgeColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      {icon && <Icon icon={icon} size={16} color={ink} />}
      <Text variant="badge" style={[styles.label, { color: ink }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.badge,
    flexDirection: "row",
    flexShrink: 1,
    gap: space.xs,
    minHeight: 24,
    paddingHorizontal: 10,
    paddingVertical: space.xs,
  },
  label: { flexShrink: 1 },
});
