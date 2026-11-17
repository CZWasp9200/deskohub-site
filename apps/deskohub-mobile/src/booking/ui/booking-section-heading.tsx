import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/text";
import { space, touchTarget } from "../../ui/tokens";

/**
 * A booking step's section heading (`.bk-h`): 17/24 600 on the screen
 * edge, 20 above (4 when `first`), with an optional grey aside on the right
 * such as "Optional", an orange text action such as "Change", or a control
 * that adjusts the section, such as the Date's "Overnight" switch.
 */
export function BookingSectionHeading({
  title,
  aside,
  action,
  control,
  first = false,
}: {
  readonly title: string;
  readonly aside?: string;
  readonly action?: {
    readonly label: string;
    readonly onPress: () => void;
    readonly disabled?: boolean;
  };
  /** A control on the right, centred on the title, that sets the section. */
  readonly control?: ReactNode;
  readonly first?: boolean;
}) {
  return (
    <View
      style={[
        styles.heading,
        control !== undefined && styles.withControl,
        first && styles.first,
      ]}
    >
      <Text variant="headline" role="heading" style={styles.title}>
        {title}
      </Text>
      {aside !== undefined && (
        <Text variant="bodySmall" tone="muted">
          {aside}
        </Text>
      )}
      {action !== undefined && (
        <Pressable
          role="button"
          onPress={action.onPress}
          disabled={action.disabled}
          aria-disabled={action.disabled}
          hitSlop={space.md}
          style={styles.action}
        >
          <Text
            variant="bodyStrong"
            tone={action.disabled ? "muted" : "action"}
          >
            {action.label}
          </Text>
        </Pressable>
      )}
      {control}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: space.md,
    justifyContent: "space-between",
    paddingBottom: space.sm,
    paddingTop: space.xl,
  },
  // A control is taller than the title's baseline row; centre them.
  withControl: { alignItems: "center" },
  first: { paddingTop: space.xs },
  title: { flexShrink: 1 },
  action: { justifyContent: "center", minHeight: touchTarget / 2 },
});
