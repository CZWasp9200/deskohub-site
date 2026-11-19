import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusedStatusBar } from "./focused-status-bar";
import { Text } from "./text";
import { color, space } from "./tokens";
import { type ContentWidth, useContentColumn, useViewport } from "./viewport";

/**
 * The navy band at the top of a tab root, under the status bar (whose
 * content turns light while the screen has focus): the screen's display
 * title, an optional subtitle, and `children` above the title, such as the
 * account's identity. A screen that shows one hides its stack header.
 *
 * A `compact` masthead instead leads with the title as a small muted label,
 * with `actions` at the end of its line, and puts `children` (the
 * account's identity) under it as the band's subject.
 */
export function Masthead({
  title,
  subtitle,
  children,
  compact = false,
  actions,
  contentWidth,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children?: ReactNode;
  readonly compact?: boolean;
  /** Buttons at the end of a compact masthead's title line. */
  readonly actions?: ReactNode;
  readonly contentWidth?: ContentWidth;
}) {
  const insets = useSafeAreaInsets();
  const { isWide } = useViewport();
  const column = useContentColumn(contentWidth);

  return (
    <View
      style={[
        styles.band,
        !isWide && styles.compactBand,
        { paddingTop: insets.top + space.md },
      ]}
    >
      <FocusedStatusBar style="light" />
      <View style={isWide ? column : undefined}>
        {compact ? (
          <View style={styles.compactTitleLine}>
            <Text variant="headline" role="heading" style={styles.compactTitle}>
              {title}
            </Text>
            {actions !== undefined && (
              <View style={styles.actions}>{actions}</View>
            )}
          </View>
        ) : null}
        {children}
        {!compact && (
          <Text variant="display" tone="inverse" role="heading">
            {title}
          </Text>
        )}
        {!compact && subtitle !== undefined && (
          <Text variant="lead" style={styles.subtitle}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: color.navy,
    paddingBottom: space.md,
  },
  compactBand: { paddingHorizontal: space.xl },
  subtitle: { color: color.onNavyMuted, marginTop: 6 },
  compactTitleLine: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: space.sm,
    minHeight: 24,
  },
  // 16/24 600 in the muted on-navy colour (board 11).
  compactTitle: {
    color: color.onNavyMuted,
    flex: 1,
    fontSize: 16,
  },
  // The 48 target keeps its size; it overhangs the title line instead of
  // growing the band.
  actions: {
    flexDirection: "row",
    marginRight: -space.md,
    marginVertical: -space.md,
  },
});
