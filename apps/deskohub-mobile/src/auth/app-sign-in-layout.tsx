import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { useKeyboardResizedViewport } from "../ui/keyboard-viewport";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";

/**
 * The page layout of each sign-in step the app opens in the browser: the
 * title, instructions and a quiet "Use a different email" link on top, the
 * step's field in the middle, and its one action at the bottom (directly
 * above the on-screen keyboard while it is open). The content scrolls when it
 * doesn't fit.
 */
export function AppSignInLayout({
  title,
  instructions,
  onUseDifferentEmail,
  useDifferentEmailDisabled = false,
  children,
  childrenPlacement = "centred",
  action,
}: {
  readonly title: string;
  /** Text, or text with emphasised parts such as the address. */
  readonly instructions?: ReactNode;
  /** Starts over with another address; without it the link isn't shown. */
  readonly onUseDifferentEmail?: () => void;
  readonly useDifferentEmailDisabled?: boolean;
  /** The step's field block, centred in the free space by default. */
  readonly children?: ReactNode;
  /** `under-text`: the block starts right under the heading (board 19). */
  readonly childrenPlacement?: "centred" | "under-text";
  /** The step's primary action, at the bottom. */
  readonly action?: ReactNode;
}) {
  const locale = useAppLocale();
  const viewport = useKeyboardResizedViewport();
  return (
    <SafeAreaView
      style={[
        styles.page,
        // Fills the page, but no further down than the keyboard leaves visible.
        viewport && {
          maxHeight: viewport.height,
          transform: [{ translateY: viewport.offsetTop }],
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <Text role="heading" aria-level={1} variant="titleLarge">
            {title}
          </Text>
          {instructions !== undefined && (
            <Text variant="body" tone="muted" style={styles.instructions}>
              {instructions}
            </Text>
          )}
          {onUseDifferentEmail && (
            <Pressable
              role="link"
              onPress={onUseDifferentEmail}
              disabled={useDifferentEmailDisabled}
              aria-disabled={useDifferentEmailDisabled}
              hitSlop={{ top: 12, bottom: 12 }}
              style={styles.differentEmail}
            >
              <Text variant="hint" style={styles.differentEmailText}>
                {m.signin_use_another_email({}, { locale })}
              </Text>
            </Pressable>
          )}
        </View>
        <View
          style={
            childrenPlacement === "centred" ? styles.spacer : styles.underText
          }
        />
        {children !== undefined && <View>{children}</View>}
        <View style={styles.spacer} />
        {action}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: color.paper, flex: 1 },
  content: {
    alignSelf: "center",
    flexGrow: 1,
    maxWidth: 480,
    paddingBottom: space.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    width: "100%",
  },
  head: { gap: space.sm },
  instructions: { fontSize: 15, lineHeight: 22 },
  differentEmail: { alignSelf: "flex-start" },
  differentEmailText: {
    lineHeight: 20,
    textDecorationLine: "underline",
  },
  spacer: { flexGrow: 1, minHeight: space.xxl },
  underText: { height: space.xxl },
});
