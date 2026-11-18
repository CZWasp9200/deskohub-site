import { StyleSheet } from "react-native";
import { space } from "../../ui/tokens";
import { contentColumnWidth, useViewport, wideGutter } from "../../ui/viewport";

export function useChooseTracks(count: 2 | 3): boolean {
  const { availableWidth, fontScale, isExpanded } = useViewport();
  const width = Math.min(
    availableWidth - 2 * wideGutter,
    contentColumnWidth.wide
  );
  // Keep the date grid and the booking controls readable at larger text sizes.
  return (
    isExpanded &&
    (width - (count - 1) * space.xxl) / fontScale >= (count === 3 ? 810 : 650)
  );
}

export function useCoworkTierPair(tracks: boolean): boolean {
  const { availableWidth, fontScale, isWide } = useViewport();
  const width = Math.min(
    availableWidth - 2 * wideGutter,
    contentColumnWidth.wide
  );
  return isWide && !tracks && (width - space.sm) / (2 * fontScale) >= 246;
}

export const chooseStyles = StyleSheet.create({
  row: { flexDirection: "row", flexGrow: 1, gap: space.xxl },
  track: { flex: 1, minWidth: 0 },
  calendar: { flex: 1.2, minWidth: 0 },
  meetingCalendar: { flex: 1.54, minWidth: 0 },
  officeCalendar: { flex: 2, minWidth: 0 },
});
