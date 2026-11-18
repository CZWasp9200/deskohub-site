import { useState } from "react";
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
  wrap = false,
}: {
  readonly label: string;
  readonly tone: BadgeTone;
  /** A Lucide icon before the label. */
  readonly icon?: IconComponent;
  /**
   * Lets the label wrap onto more lines in a narrow space, between words
   * only (it never gets narrower than its longest word), the icon kept on
   * the first line.
   */
  readonly wrap?: boolean;
}) {
  const { background, ink } = badgeColors[tone];
  const [longestWord, setLongestWord] = useState(0);
  const word = wrap
    ? label.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), "")
    : "";
  return (
    <View
      style={[
        styles.badge,
        wrap && styles.badgeWrap,
        { backgroundColor: background },
      ]}
    >
      {/* Its 16pt icon matches the label's line height, so a wrapped
          badge, aligned to the top, keeps the icon on the first line. */}
      {icon && <Icon icon={icon} size={16} color={ink} />}
      <Text
        variant="badge"
        style={[
          styles.label,
          wrap && { minWidth: longestWord },
          { color: ink },
        ]}
      >
        {label}
      </Text>
      {wrap && (
        // Measures the longest word, so the label never breaks inside it.
        <Text
          aria-hidden
          variant="badge"
          numberOfLines={1}
          onLayout={(event) =>
            setLongestWord(Math.ceil(event.nativeEvent.layout.width))
          }
          style={styles.measure}
        >
          {word}
        </Text>
      )}
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
  badgeWrap: { alignItems: "flex-start" },
  measure: { opacity: 0, position: "absolute" },
});
