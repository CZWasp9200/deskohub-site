import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { listRowLayout } from "./list-row-layout";
import { Text } from "./text";
import { color } from "./tokens";

/**
 * A list row that is one toggle: the whole row is the `switch` or `checkbox`
 * and its text names it, so the drawn control inside is only its picture.
 * It shares `ListRow`'s layout, so it sits in a `ListGroup` beside them.
 */
export function ToggleRow({
  role,
  label,
  labelWeight,
  description,
  checked,
  onToggle,
  busy = false,
  disabled = false,
  leading,
  trailing,
  align,
}: {
  readonly role: "switch" | "checkbox";
  readonly label: string;
  /** A switch's title is bold, a checkbox's sentence regular. */
  readonly labelWeight: "strong" | "regular";
  readonly description?: string;
  readonly checked: boolean;
  readonly onToggle: (checked: boolean) => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  /** `top` keeps the control on a wrapping label's first line. */
  readonly align: "center" | "top";
}) {
  const textTone = disabled ? { color: color.disabledInk } : undefined;
  return (
    <Pressable
      role={role}
      aria-checked={checked}
      aria-disabled={disabled}
      aria-busy={busy}
      disabled={disabled}
      onPress={busy ? undefined : () => onToggle(!checked)}
      style={({ pressed }) => [
        listRowLayout.row,
        description !== undefined && listRowLayout.withDescription,
        align === "top" && styles.top,
        pressed && !disabled && !busy && styles.pressed,
      ]}
    >
      {leading}
      <View style={listRowLayout.text}>
        <Text
          variant={labelWeight === "strong" ? "bodyStrong" : "body"}
          style={textTone}
        >
          {label}
        </Text>
        {description === undefined ? null : (
          <Text variant="bodySmall" style={textTone}>
            {description}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: "flex-start" },
  pressed: { backgroundColor: color.pressed },
});
