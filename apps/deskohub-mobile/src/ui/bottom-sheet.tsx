import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "./reduced-motion";
import { Text } from "./text";
import { color, radius, shadow, space } from "./tokens";
import { useKeyboardHeight } from "./use-keyboard-shown";

const slideMs = 240;

/**
 * The space under a sheet's content: clear of the on-screen keyboard while
 * it's up, else of the bottom safe area.
 */
export const sheetBottomInset = ({
  safeAreaBottom,
  keyboardHeight,
}: {
  readonly safeAreaBottom: number;
  readonly keyboardHeight: number;
}) => (keyboardHeight > 0 ? keyboardHeight : safeAreaBottom) + space.sm;

/**
 * A white sheet that slides up from the bottom over the navy scrim, for
 * pickers and short choices. Its content scrolls when it's taller than the
 * screen allows; the bottom safe area, and the keyboard while it's up, stay
 * clear, and a tap on a row picks it even while the keyboard is up. A
 * `header`, such as a search field, stays put above the scrolling content.
 * The back button and a tap on the scrim call `onDismiss`.
 */
export function BottomSheet({
  visible,
  title,
  header,
  onDismiss,
  children,
}: {
  readonly visible: boolean;
  readonly title?: string;
  /** Content under the title that doesn't scroll, such as a search field. */
  readonly header?: ReactNode;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion() !== false;
  // The modal stays up while the sheet slides away.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(shown, {
      toValue: visible ? 1 : 0,
      duration: reducedMotion ? 0 : slideMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, reducedMotion, shown]);
  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={[styles.frame, { paddingTop: insets.top + space.xxxl }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]}>
          <Pressable
            accessible={false}
            importantForAccessibility="no"
            onPress={onDismiss}
            style={styles.scrim}
          />
        </Animated.View>
        <Animated.View
          role="dialog"
          aria-modal
          aria-label={title}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              paddingBottom: sheetBottomInset({
                safeAreaBottom: insets.bottom,
                keyboardHeight,
              }),
            },
            {
              transform: [
                {
                  translateY: shown.interpolate({
                    inputRange: [0, 1],
                    outputRange: [height, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View aria-hidden style={styles.handle} />
          {title !== undefined && (
            <Text variant="title" role="heading" style={styles.title}>
              {title}
            </Text>
          )}
          {header !== undefined && <View style={styles.header}>{header}</View>}
          <ScrollView
            style={styles.scroll}
            // One tap on a row picks it while the keyboard is up.
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, justifyContent: "flex-end" },
  scrim: { backgroundColor: color.scrim, flex: 1 },
  sheet: {
    alignSelf: "center",
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.overlay,
    borderTopRightRadius: radius.overlay,
    flexShrink: 1,
    maxWidth: 640,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    width: "100%",
    ...shadow.sheet,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: color.handle,
    borderRadius: 2,
    height: 4,
    marginBottom: 14,
    marginTop: 6,
    width: 32,
  },
  title: { paddingBottom: space.sm, paddingHorizontal: space.xs },
  header: { paddingBottom: space.md },
  scroll: { flexGrow: 0, flexShrink: 1 },
});
