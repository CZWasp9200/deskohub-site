import type { BottomTabBarProps } from "expo-router/tabs";
import { BottomTabBarHeightCallbackContext } from "expo-router/tabs";
import { use } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "./icon";
import { useToastObstruction } from "./toast";
import { color, radius, tabBarRaisedOverhang } from "./tokens";

/** How a tab shows in the bar: its icon, and whether it is the raised one. */
export interface TabBarItem {
  readonly icon: IconComponent;
  /** The main action: a large orange circle raised out of the bar. */
  readonly raised?: boolean;
  /** A small orange dot on the icon: something there needs the customer. */
  readonly dot?: boolean;
}

/** The bar's height above the bottom safe area. */
export const tabBarHeight = 56;

/**
 * How much of the screen's bottom the bar covers, for toasts: nothing while
 * hidden, else the bar with its safe area plus the raised circle's overhang
 * when a tab is raised.
 */
export function tabBarObstruction(
  height: number,
  items: Readonly<Record<string, TabBarItem>>,
  hidden: boolean
): number {
  if (hidden) return 0;
  const raised = Object.values(items).some((item) => item.raised === true);
  return height + (raised ? tabBarRaisedOverhang : 0);
}

/**
 * The app's bottom tab bar: icons only, no titles and no top border, in the
 * order the navigator lists its tabs. A `raised` tab is a large orange
 * circle that rises out of the bar; the others show the open tab as a
 * tinted pill. Each tab's name (its screen `title`, or
 * `tabBarAccessibilityLabel`) is its accessible label. Presses emit
 * `tabPress` and `tabLongPress` as the default bar does, so a tab's stack
 * still returns to its root when its open tab is pressed again. A `hidden`
 * bar draws nothing and leaves toasts the whole bottom.
 */
export function TabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  items,
  hidden = false,
}: Pick<
  BottomTabBarProps,
  "state" | "descriptors" | "emitter" | "navigateToTab" | "insets"
> & {
  readonly items: Readonly<Record<string, TabBarItem>>;
  /** The open screen has its own footer: the bar takes no room at all. */
  readonly hidden?: boolean;
}) {
  const height = tabBarHeight + insets.bottom;
  const onHeightChange = use(BottomTabBarHeightCallbackContext);
  useToastObstruction(tabBarObstruction(height, items, hidden));
  if (hidden) return null;
  return (
    <View
      role="tablist"
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[styles.bar, { height, paddingBottom: insets.bottom }]}
    >
      {state.routes.map((route, index) => {
        const item = items[route.name];
        if (item === undefined) return null;
        const focused = index === state.index;
        const options = descriptors[route.key]?.options;
        const label = options?.tabBarAccessibilityLabel ?? options?.title;
        const onPress = () => {
          const event = emitter.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        const onLongPress = () =>
          emitter.emit({ type: "tabLongPress", target: route.key });
        return (
          <Pressable
            key={route.key}
            // TalkBack and the web announce tabs; VoiceOver ignores `tab`.
            role={Platform.OS === "ios" ? "button" : "tab"}
            aria-label={label}
            aria-selected={focused}
            onPress={onPress}
            onLongPress={onLongPress}
            style={item.raised ? styles.raisedTab : styles.tab}
          >
            {({ pressed }) =>
              item.raised ? (
                <View
                  style={[
                    styles.circle,
                    (focused || pressed) && styles.circleActive,
                  ]}
                >
                  <Icon icon={item.icon} size={30} color={color.white} />
                </View>
              ) : (
                <View
                  style={[
                    styles.pill,
                    pressed && styles.pillPressed,
                    focused && styles.pillActive,
                  ]}
                >
                  <View>
                    <Icon
                      icon={item.icon}
                      size={26}
                      color={focused ? color.action : color.ink2}
                    />
                    {item.dot === true && (
                      <View aria-hidden style={styles.dot} />
                    )}
                  </View>
                </View>
              )
            }
          </Pressable>
        );
      })}
    </View>
  );
}

const raisedSize = 72;

const styles = StyleSheet.create({
  bar: {
    backgroundColor: color.surface,
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    // The raised circle reaches above the bar.
    overflow: "visible",
  },
  tab: {
    alignItems: "center",
    height: tabBarHeight,
    justifyContent: "center",
    width: 96,
  },
  raisedTab: { alignItems: "center", height: tabBarHeight, width: 84 },
  pill: {
    alignItems: "center",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 56,
  },
  pillPressed: { backgroundColor: color.pressed },
  dot: {
    backgroundColor: color.action,
    borderColor: color.surface,
    borderRadius: radius.pill,
    borderWidth: 2,
    // 8 across inside its white ring, at the icon's top end.
    height: 12,
    position: "absolute",
    right: -5,
    top: -3,
    width: 12,
  },
  pillActive: { backgroundColor: color.actionTint },
  circle: {
    alignItems: "center",
    backgroundColor: color.action,
    borderRadius: radius.pill,
    boxShadow: "0 10px 18px -8px rgba(150, 48, 4, 0.75)",
    height: raisedSize,
    justifyContent: "center",
    marginTop: -tabBarRaisedOverhang,
    width: raisedSize,
  },
  circleActive: { backgroundColor: color.actionPressed },
});
