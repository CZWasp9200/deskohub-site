import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { space } from "./tokens";

/**
 * At this text scale two fields no longer share a line at phone width, as a
 * list row's own trailing content moves under its label.
 */
const stackedFontScale = 1.3;

/**
 * Two fields side by side, the first wider, such as city and postal code.
 * They wrap under each other when they no longer fit, and always stack at
 * large text sizes, so neither cuts its value short.
 */
export function FieldPair({
  wide,
  narrow,
}: {
  readonly wide: ReactNode;
  readonly narrow: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= stackedFontScale;
  return (
    <View style={[styles.pair, stacked && styles.stacked]}>
      <View style={!stacked && styles.wide}>{wide}</View>
      <View style={!stacked && styles.narrow}>{narrow}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  pair: {
    columnGap: space.md,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: space.lg,
  },
  // Wrapping would size each field to its content; stacked, they fill the width.
  stacked: { flexDirection: "column", flexWrap: "nowrap" },
  wide: { flexBasis: 160, flexGrow: 1.4 },
  narrow: { flexBasis: 110, flexGrow: 1 },
});
