import { StyleSheet } from "react-native";
import { space } from "../../ui/tokens";
import {
  type ContentWidth,
  contentColumnWidth,
  useViewport,
  wideGutter,
} from "../../ui/viewport";

export function useCheckoutLayout(): {
  readonly contentWidth: ContentWidth;
  readonly isWide: boolean;
} {
  const { availableWidth, fontScale, isExpanded, isWide } = useViewport();
  const usableWidth = Math.min(
    availableWidth - 2 * wideGutter,
    contentColumnWidth.wide
  );
  // Give each track the room of a compact form at the current text scale.
  const tracksFit = usableWidth >= 2 * 360 * fontScale + space.xxl;
  const contentWidth = isExpanded && tracksFit ? "wide" : "form";
  return { contentWidth, isWide };
}

export const checkoutTrackStyles = StyleSheet.create({
  container: { alignItems: "flex-start", flexDirection: "row", gap: space.xxl },
  track: { flex: 1, minWidth: 0 },
});
