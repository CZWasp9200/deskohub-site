import ArrowLeft from "lucide-react-native/icons/arrow-left";
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
 * title wraps to a second line at large font sizes before it truncates.
 * `raised` draws a hairline under the bar once content scrolls beneath it.
 */
export function AppBar({
  title,
  onBack,
  actions,
  raised = false,
}: {
  readonly title: string;
  readonly onBack?: () => void;
  readonly actions?: ReactNode;
  readonly raised?: boolean;
}) {
  const locale = useAppLocale();
  return (
    <View style={[styles.bar, raised && styles.raised]}>
      {onBack ? (
        <Pressable
          role="button"
          aria-label={m.navigation_back({}, { locale })}
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Icon icon={ArrowLeft} />
        </Pressable>
      ) : (
        <View style={styles.lead} />
      )}
      <Text
        variant="title"
        role="heading"
        numberOfLines={2}
        style={styles.title}
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
    gap: space.xs,
    minHeight: 64,
    paddingLeft: space.xs,
    paddingRight: space.sm,
    paddingVertical: space.xs,
  },
  raised: { borderBottomColor: color.line },
  back: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { backgroundColor: color.sunken },
  lead: { width: space.md },
  title: { flex: 1, minWidth: 0, paddingLeft: space.xs },
  actions: { alignItems: "center", flexDirection: "row", flexShrink: 0 },
});
