import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { idleLiveRegionLayout } from "./notice-presentation";
import { Text } from "./text";
import { useToastObstruction } from "./toast";
import { color, radius, space } from "./tokens";
import {
  type ContentWidth,
  contentColumnWidth,
  useViewport,
  wideGutter,
} from "./viewport";

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
  aside,
  contentWidth = "form",
  children,
}: {
  readonly message?: string;
  readonly messageTone?: ActionFooterMessageTone;
  readonly aside?: ReactNode;
  readonly contentWidth?: ContentWidth;
  readonly children: ReactNode;
}) {
  const { bottom } = useSafeAreaInsets();
  const { availableWidth, fontScale, isWide } = useViewport();
  const [height, setHeight] = useState(0);
  useToastObstruction(height);
  const shown = message !== undefined && message !== "";
  useLiveRegionAnnouncement(shown ? message : undefined, "polite");
  const width = Math.max(
    0,
    Math.min(availableWidth - 2 * wideGutter, contentColumnWidth[contentWidth])
  );
  const inline = isWide && width >= 400 * Math.max(1, fontScale);
  const inlineMessage =
    inline && aside === undefined && messageTone !== "error";
  const messageLayout = inlineMessage ? styles.inlineMessage : styles.message;
  const announcement = (
    <Text
      role="status"
      aria-live="polite"
      accessibilityLiveRegion="polite"
      variant={messageTone === "error" ? "hintStrong" : "hint"}
      tone={messageTone === "error" ? "danger" : "muted"}
      style={shown ? messageLayout : idleLiveRegionLayout}
    >
      {shown ? message : ""}
    </Text>
  );
  return (
    <View
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[
        styles.footer,
        isWide && [styles.wideFooter, { width }],
        { paddingBottom: space.md + bottom },
      ]}
    >
      {!inlineMessage && announcement}
      <View style={inline ? styles.row : styles.stacked}>
        {aside !== undefined && (
          <View style={inline ? styles.aside : undefined}>{aside}</View>
        )}
        {inlineMessage && announcement}
        <View style={inline ? styles.actions : undefined}>{children}</View>
      </View>
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
  wideFooter: {
    alignSelf: "center",
    borderColor: color.line,
    borderTopLeftRadius: radius.overlay,
    borderTopRightRadius: radius.overlay,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
  },
  stacked: { gap: space.sm },
  aside: { flex: 1, minWidth: 0 },
  actions: { flexShrink: 1, marginLeft: "auto", maxWidth: "60%" },
  message: { textAlign: "center" },
  inlineMessage: { flex: 1, minWidth: 0 },
});
