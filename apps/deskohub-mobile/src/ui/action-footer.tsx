import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { idleLiveRegionLayout } from "./notice-presentation";
import { Text } from "./text";
import { useToastObstruction } from "./toast";
import { color, space } from "./tokens";

/** How a footer's message reads: neutral status, or a crimson error. */
export type ActionFooterMessageTone = "neutral" | "error";

/**
 * The white footer pinned under a form, above the gesture bar, holding its
 * buttons. An optional message, such as why saving is off or how many
 * fields to fix, sits centred above them. The message shows in a live
 * region that stays mounted, so each new message is announced. For one
 * button's own reason use `Button`'s `disabledReason` instead, never both.
 * Toasts rise above the footer while its screen has focus.
 */
export function ActionFooter({
  message,
  messageTone = "neutral",
  children,
}: {
  readonly message?: string;
  readonly messageTone?: ActionFooterMessageTone;
  readonly children: ReactNode;
}) {
  const { bottom } = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  useToastObstruction(height);
  const shown = message !== undefined && message !== "";
  useLiveRegionAnnouncement(shown ? message : undefined, "polite");
  return (
    <View
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[styles.footer, { paddingBottom: space.md + bottom }]}
    >
      <Text
        role="status"
        aria-live="polite"
        // Text doesn't map `aria-live` to Android's live region; View does.
        accessibilityLiveRegion="polite"
        variant={messageTone === "error" ? "hintStrong" : "hint"}
        tone={messageTone === "error" ? "danger" : "muted"}
        style={shown ? styles.message : idleLiveRegionLayout}
      >
        {shown ? message : ""}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    backgroundColor: color.surface,
    borderTopColor: color.line,
    borderTopWidth: 1,
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
  },
  message: { textAlign: "center" },
});
