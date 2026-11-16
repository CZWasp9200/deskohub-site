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

const slideMs = 240;

/**
 * A white sheet that slides up from the bottom over the navy scrim, for
 * pickers and short choices. Its content scrolls when it's taller than the
 * screen allows; the bottom safe area stays clear. The back button and a
 * tap on the scrim call `onDismiss`.
 */
export function BottomSheet({
  visible,
  title,
  onDismiss,
  children,
}: {
  readonly visible: boolean;
  readonly title?: string;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
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
            { paddingBottom: insets.bottom + space.sm },
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
          <ScrollView style={styles.scroll}>{children}</ScrollView>
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
  scroll: { flexGrow: 0, flexShrink: 1 },
});
