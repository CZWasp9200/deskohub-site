import { createContext, type ReactNode, useContext } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../text";
import { color, radius, space } from "../tokens";

/**
 * The design-system gallery's building blocks. The gallery is a development
 * tool: its sample copy is fixture text in English, like synthetic data, not
 * customer copy, so it stays out of the message catalogs.
 */

const LongTextContext = createContext(false);

/** Shows every sample 30% longer below it, as `useSample` stretches them. */
export const LongTextProvider = LongTextContext.Provider;

/**
 * `text`, or with the gallery's longer-text switch on, `text` stretched to
 * at least 30% more characters by repeating its own words, so a layout can be
 * checked against translations that run long.
 */
const stretchText = (text: string): string => {
  const words = text.split(" ");
  const target = Math.ceil(text.length * 1.3);
  let stretched = text;
  for (let index = 0; stretched.length < target; index++) {
    stretched += ` ${words[index % words.length]}`;
  }
  return stretched;
};

/** The sample-text function for the gallery's current length setting. */
export const useSample = (): ((text: string) => string) => {
  const long = useContext(LongTextContext);
  return long ? stretchText : (text) => text;
};

/** A titled group of cases, one board part. */
export function GallerySection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text variant="headline" role="heading">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** One component state, captioned with the state's name. */
export function GalleryCase({
  label,
  surface = "paper",
  children,
}: {
  readonly label: string;
  /** The ground the case sits on: the paper canvas, a white card or navy. */
  readonly surface?: "paper" | "white" | "navy";
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.case}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View style={[styles.ground, styles[surface]]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.lg, paddingBottom: space.xxl },
  case: { gap: space.sm },
  ground: { borderRadius: radius.group, gap: space.md },
  paper: {},
  white: { backgroundColor: color.surface, padding: space.lg },
  navy: { backgroundColor: color.navy, padding: space.lg },
});
