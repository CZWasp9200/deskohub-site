import ArrowLeft from "lucide-react-native/icons/arrow-left";
import X from "lucide-react-native/icons/x";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Icon } from "./icon";
import { Text } from "./text";
import { color, space, touchTarget } from "./tokens";

/**
 * The top bar of a sub-screen on the paper canvas: a back arrow when
 * `onBack` is given, the screen's title, and `actions` at the end. The
 * title keeps at least half the bar and wraps rather than truncating; when
 * the actions no longer fit beside it, as at large font sizes, they move to
 * a line of their own under it, at the end.
 * `raised` draws a hairline under the bar once content scrolls beneath it.
 * `back="close"` draws a close cross instead of the arrow, for a screen that
 * ends a flow rather than stepping back through it. `tone="navy"` draws the
 * bar on brand navy with white content, over a navy screen top.
 */
export function AppBar({
  title,
  onBack,
  actions,
  raised = false,
  back = "back",
  tone = "paper",
}: {
  readonly title: string;
  readonly onBack?: () => void;
  readonly back?: "back" | "close";
  readonly actions?: ReactNode;
  readonly raised?: boolean;
  readonly tone?: "paper" | "navy";
}) {
  const locale = useAppLocale();
  const navy = tone === "navy";
  return (
    <View style={[styles.bar, navy && styles.navyBar, raised && styles.raised]}>
      {onBack ? (
        <Pressable
          role="button"
          aria-label={
            back === "close"
              ? m.navigation_close({}, { locale })
              : m.navigation_back({}, { locale })
          }
          onPress={onBack}
          style={({ pressed }) => [
            styles.back,
            pressed && (navy ? styles.navyPressed : styles.pressed),
          ]}
        >
          <Icon
            icon={back === "close" ? X : ArrowLeft}
            color={navy ? color.white : color.navy}
          />
        </Pressable>
      ) : (
        <View style={styles.lead} />
      )}
      <Text
        variant="title"
        role="heading"
        style={[styles.title, navy && styles.navyTitle]}
      >
        {title}
      </Text>
      {actions !== undefined && <View style={styles.actions}>{actions}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: color.paper,
    // Always drawn, so turning `raised` on doesn't shift the bar's content.
    borderBottomColor: "transparent",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.xs,
    minHeight: 64,
    paddingLeft: space.xs,
    paddingRight: space.sm,
    paddingVertical: space.xs,
  },
  navyBar: { backgroundColor: color.navy },
  raised: { borderBottomColor: color.line },
  back: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { backgroundColor: color.sunken },
  navyPressed: { backgroundColor: "rgba(255, 255, 255, 0.12)" },
  lead: { width: space.md },
  title: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: "50%",
    paddingLeft: space.xs,
  },
  navyTitle: { color: color.white },
  // Wraps under the title when the title's half and the actions can't share
  // the line; a long action label then wraps within the bar's width.
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: space.xs,
    marginLeft: "auto",
    maxWidth: "100%",
  },
});
