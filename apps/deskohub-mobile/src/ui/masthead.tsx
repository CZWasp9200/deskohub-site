import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusedStatusBar } from "./focused-status-bar";
import { Text } from "./text";
import { color, space } from "./tokens";

/**
 * The navy band at the top of a tab root, under the status bar (whose
 * content turns light while the screen has focus): the screen's display
 * title, an optional subtitle, and `children` above the title, such as the
 * account's identity. A screen that shows one hides its stack header.
 */
export function Masthead({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.band, { paddingTop: insets.top + space.md }]}>
      <FocusedStatusBar style="light" />
      {children}
      <Text variant="display" tone="inverse" role="heading">
        {title}
      </Text>
      {subtitle !== undefined && (
        <Text variant="lead" style={styles.subtitle}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: color.navy,
    paddingBottom: space.md,
    paddingHorizontal: space.xl,
  },
  subtitle: { color: color.onNavyMuted, marginTop: 6 },
});
