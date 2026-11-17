import {
  type ComponentRef,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  FocusedFieldContext,
  useFocusedFieldScroll,
} from "./focused-field-scroll";
import { LoadingIndicator } from "./loading-indicator";
import { color, radius, shadow, space, tabBarRaisedOverhang } from "./tokens";

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
 * Starts a tab root's content below the masthead's navy overlap, for content
 * that doesn't open with a card (such as a section header), whose text would
 * otherwise sit on the navy band.
 */
export function MastheadClearance() {
  return <View aria-hidden style={styles.clearance} />;
}

/**
 * A scrolling screen under a navigation header (or its own `masthead`) and
 * above the tab bar, which own the top and bottom insets. Content sits on
 * the screen gutter. A `masthead` scrolls with the content, and the first
 * content overlaps its navy band. Passing `onRefresh` turns on
 * pull-to-refresh; `refreshing` shows the loading indicator at the top
 * while it runs. Its content can scroll it back to the top with
 * `useScrollScreenToTop`. A `collapsedHeader`, such as an `AppBar` with the
 * masthead's title and actions (and a dark `FocusedStatusBar`), takes the
 * top of the screen under the status bar once the masthead has scrolled
 * away. `overlap={false}` starts the content below a band that ends with
 * its own content, such as the access PIN's. A focused field scrolls whole
 * above whatever follows the screen, such as an `ActionFooter`.
 */
export function ScrollScreen({
  children,
  masthead,
  collapsedHeader,
  refreshing = false,
  onRefresh,
  overlap = true,
}: {
  readonly children: ReactNode;
  /** The tab root's `Masthead`, drawn above the content. */
  readonly masthead?: ReactNode;
  /** Shown at the top while the masthead is scrolled out of view. */
  readonly collapsedHeader?: ReactNode;
  readonly refreshing?: boolean;
  readonly onRefresh?: () => void;
  /** Whether the first content overlaps the masthead's navy band. */
  readonly overlap?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [mastheadHeight, setMastheadHeight] = useState<number>();
  const [collapsed, setCollapsed] = useState(false);
  const scrollView = useRef<ComponentRef<typeof ScrollView>>(null);
  // Instantly: a screen coming back into view shows its top right away.
  const scrollToTop = useCallback(
    () => scrollView.current?.scrollTo({ y: 0, animated: false }),
    []
  );
  const focusedField = useFocusedFieldScroll(scrollView);
  const withMasthead = masthead !== undefined;
  const overlapping = withMasthead && overlap;
  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <FocusedFieldContext value={focusedField.tracker}>
        <ScrollView
          ref={scrollView}
          onLayout={focusedField.onLayout}
          // A tap on a button, or on a row of a sheet opened from this screen,
          // acts while the keyboard is up; elsewhere it closes the keyboard.
          // The responder system follows the React tree, so a modal sheet's
          // rows sit inside this ScrollView too.
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={collapsedHeader === undefined ? undefined : 16}
          onScroll={
            collapsedHeader === undefined || mastheadHeight === undefined
              ? undefined
              : (event) =>
                  setCollapsed(
                    event.nativeEvent.contentOffset.y >= mastheadHeight
                  )
          }
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
            {masthead !== undefined && (
              <View
                onLayout={(event) =>
                  setMastheadHeight(event.nativeEvent.layout.height)
                }
              >
                {masthead}
              </View>
            )}
            <View style={styles.page}>
              {overlapping && <View aria-hidden style={styles.overlap} />}
              <View
                style={[
                  styles.content,
                  overlapping && styles.overlapping,
                  withMasthead && !overlap && styles.belowBand,
                ]}
              >
                {children}
              </View>
            </View>
          </ScrollScreenContext>
        </ScrollView>
      </FocusedFieldContext>
      {collapsed && collapsedHeader !== undefined && (
        <View style={[styles.collapsedHeader, { paddingTop: insets.top }]}>
          {collapsedHeader}
        </View>
      )}
      {refreshing && (
        <View
          style={[
            styles.refresh,
            // On the masthead's lower edge, clear of its title (board 10b).
            withMasthead &&
              mastheadHeight !== undefined && {
                top: mastheadHeight - refreshDiscSize / 2,
              },
          ]}
        >
          <View style={styles.refreshDisc}>
            <LoadingIndicator size="inline" tone="brand" />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

/** The refresh indicator's white disc. */
const refreshDiscSize = 40;

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
    // The last control ends clear of the tab bar's raised circle.
    paddingBottom: space.xxl + tabBarRaisedOverhang,
    paddingHorizontal: space.gutter,
    paddingTop: space.sm,
    width: "100%",
  },
  overlapping: { paddingTop: 0 },
  belowBand: { paddingTop: space.lg },
  collapsedHeader: {
    backgroundColor: color.paper,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  // The overlap less the gap the content's column adds after it.
  clearance: { height: mastheadOverlap - space.md },
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
    height: refreshDiscSize,
    justifyContent: "center",
    width: refreshDiscSize,
    ...shadow.refresh,
  },
});
