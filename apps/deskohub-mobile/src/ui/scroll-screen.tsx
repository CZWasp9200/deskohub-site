import {
  type ComponentRef,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
} from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "./loading-indicator";
import { color, radius, shadow, space } from "./tokens";

/**
 * Scrolls the enclosing `ScrollScreen` back to its top; outside one, it does
 * nothing.
 */
export const ScrollScreenContext = createContext<() => void>(() => undefined);

/**
 * Brings the top of the enclosing `ScrollScreen` into view at once, for
 * content that just appeared there, such as a notice about why the screen
 * changed.
 */
export const useScrollScreenToTop = () => useContext(ScrollScreenContext);

// The pull gesture stays native; its spinner is drawn see-through so the
// shared loading indicator stands in for it.
const hiddenSpinner = "transparent";

/** How far the first content overlaps the masthead's navy band. */
const mastheadOverlap = 40;

/**
 * A scrolling screen under a navigation header (or its own `masthead`) and
 * above the tab bar, which own the top and bottom insets. Content sits on
 * the screen gutter. A `masthead` scrolls with the content, and the first
 * content overlaps its navy band. Passing `onRefresh` turns on
 * pull-to-refresh; `refreshing` shows the loading indicator at the top
 * while it runs. Its content can scroll it back to the top with
 * `useScrollScreenToTop`.
 */
export function ScrollScreen({
  children,
  masthead,
  refreshing = false,
  onRefresh,
}: {
  readonly children: ReactNode;
  /** The tab root's `Masthead`, drawn above the content. */
  readonly masthead?: ReactNode;
  readonly refreshing?: boolean;
  readonly onRefresh?: () => void;
}) {
  const scrollView = useRef<ComponentRef<typeof ScrollView>>(null);
  // Instantly: a screen coming back into view shows its top right away.
  const scrollToTop = useCallback(
    () => scrollView.current?.scrollTo({ y: 0, animated: false }),
    []
  );
  const withMasthead = masthead !== undefined;
  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <ScrollView
        ref={scrollView}
        // A masthead clears the status bar itself.
        contentInsetAdjustmentBehavior={withMasthead ? "never" : "automatic"}
        refreshControl={
          onRefresh && (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={hiddenSpinner}
              colors={[hiddenSpinner]}
              progressBackgroundColor={hiddenSpinner}
            />
          )
        }
      >
        <ScrollScreenContext value={scrollToTop}>
          {masthead}
          <View style={styles.page}>
            {withMasthead && <View aria-hidden style={styles.overlap} />}
            <View style={[styles.content, withMasthead && styles.overlapping]}>
              {children}
            </View>
          </View>
        </ScrollScreenContext>
      </ScrollView>
      {refreshing && (
        <View style={styles.refresh}>
          <View style={styles.refreshDisc}>
            <LoadingIndicator size="inline" tone="brand" />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  page: { width: "100%" },
  overlap: {
    backgroundColor: color.navy,
    height: mastheadOverlap,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  content: {
    alignSelf: "center",
    gap: space.md,
    maxWidth: 640,
    paddingBottom: space.xxl,
    paddingHorizontal: space.gutter,
    paddingTop: space.sm,
    width: "100%",
  },
  overlapping: { paddingTop: 0 },
  refresh: {
    alignItems: "center",
    left: 0,
    pointerEvents: "none",
    position: "absolute",
    right: 0,
    top: space.lg,
  },
  refreshDisc: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    width: 40,
    ...shadow.refresh,
  },
});
