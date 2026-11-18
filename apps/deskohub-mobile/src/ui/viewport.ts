import { createContext, useContext } from "react";
import { useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space } from "./tokens";

export const contentColumnWidth = { form: 640, wide: 1040 } as const;
export type ContentWidth = keyof typeof contentColumnWidth;
export const wideGutter = space.xxl;

/** Usable width inside navigation chrome or one pane of a split screen. */
export const AvailableWidthContext = createContext<number | undefined>(
  undefined
);

export function useViewport() {
  const { width, fontScale } = useWindowDimensions();
  const { left, right } = useSafeAreaInsets();
  const availableWidth =
    useContext(AvailableWidthContext) ?? width - left - right;

  return {
    width,
    fontScale,
    availableWidth: Math.max(0, availableWidth),
    isWide: width >= 600,
    isExpanded: width >= 1024,
  };
}

export function useContentColumn(
  contentWidth: ContentWidth = "form"
): ViewStyle {
  const { isWide } = useViewport();
  const gutter = isWide ? wideGutter : space.gutter;
  return {
    alignSelf: "center",
    width: "100%",
    maxWidth: isWide
      ? contentColumnWidth[contentWidth] + 2 * gutter
      : contentColumnWidth.form,
    paddingHorizontal: gutter,
  };
}
