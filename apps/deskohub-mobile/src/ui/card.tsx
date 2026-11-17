import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { color, radius, shadow, space } from "./tokens";

/**
 * A standalone white card on the paper canvas: radius 20, the warm outline
 * and a soft shadow. `padding` `none` lets content that brings its own
 * insets, such as rows or an empty state, reach the edges.
 */
export function Card({
  children,
  padding = "regular",
}: {
  readonly children: ReactNode;
  readonly padding?: "regular" | "none";
}) {
  return (
    <View style={[styles.card, padding === "regular" && styles.padded]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.card,
    borderWidth: 1,
    ...shadow.card,
  },
  padded: { padding: space.xl },
});
