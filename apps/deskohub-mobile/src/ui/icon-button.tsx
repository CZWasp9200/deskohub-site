import { useState } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { showsFocusRing } from "./controls";
import { Icon, type IconComponent } from "./icon";
import { color, touchTarget } from "./tokens";

/** How an icon button is drawn: bare, on a sunken disc, or confirming. */
export type IconButtonTone = "plain" | "tint" | "positive";

const toneStyle = {
  plain: { backgroundColor: "transparent", iconColor: color.navy },
  tint: { backgroundColor: color.sunken, iconColor: color.navy },
  positive: {
    backgroundColor: color.positiveTint,
    iconColor: color.positiveInk,
  },
} as const satisfies Record<
  IconButtonTone,
  { readonly backgroundColor: string; readonly iconColor: string }
>;

/**
 * A round 48 dp button that shows only an icon, such as Copy or a row's
 * "More" menu. `label` is its accessible name, since nothing else names it.
 */
export function IconButton({
  icon,
  label,
  onPress,
  tone = "plain",
  disabled = false,
}: {
  readonly icon: IconComponent;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: IconButtonTone;
  readonly disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const look = toneStyle[tone];
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      onFocus={(event) => setFocused(showsFocusRing(Platform.OS, event.target))}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.backgroundColor },
        pressed && !disabled && styles.pressed,
        focused && styles.focused,
      ]}
    >
      <Icon
        icon={icon}
        size={20}
        color={disabled ? color.disabledInk : look.iconColor}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { opacity: 0.7 },
  focused: { borderColor: color.navy, borderWidth: 2 },
});
