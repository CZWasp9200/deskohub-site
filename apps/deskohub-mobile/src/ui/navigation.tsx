import { mapSupportedLocales } from "@deskohub/i18n/locale-registry";
import type {
  NativeStackHeaderProps,
  NativeStackNavigationOptions,
} from "expo-router";
import type { BottomTabNavigationOptions } from "expo-router/tabs";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLocale } from "../i18n/app-locale";
import { theme } from "../theme";
import { AppBar } from "./app-bar";
import { FocusedStatusBar } from "./focused-status-bar";
import { localeTextStyle } from "./text-style";
import { color } from "./tokens";

// Options are one object per locale, so a navigator sees the same options
// until the locale changes. The stack header is the app's own `AppBar`,
// whose Text follows the locale; the tab bar draws its own labels, out of
// reach of the app's Text, so its options carry the locale's font (see
// `localeTextStyle`).

/** The title a screen's options give it, falling back to its route's name. */
const headerTitle = (
  options: NativeStackNavigationOptions,
  routeName: string
): string =>
  typeof options.headerTitle === "string"
    ? options.headerTitle
    : (options.title ?? routeName);

/**
 * A stack screen's header: the app bar below the top safe area, with a
 * back arrow when there is a screen to go back to (unless the screen turns
 * it off with `headerBackVisible: false`), the screen's `headerRight`
 * actions, and the hairline when it sets `headerShadowVisible`. The status
 * bar's content is dark on the paper canvas.
 */
export function StackHeader({
  back,
  options,
  route,
  navigation,
}: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const canGoBack = back !== undefined;
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <FocusedStatusBar style="dark" />
      <AppBar
        title={headerTitle(options, route.name)}
        onBack={
          canGoBack && options.headerBackVisible !== false
            ? () => navigation.goBack()
            : undefined
        }
        actions={options.headerRight?.({ tintColor: color.navy, canGoBack })}
        raised={options.headerShadowVisible === true}
      />
    </View>
  );
}

const renderStackHeader = (props: NativeStackHeaderProps) => (
  <StackHeader {...props} />
);

const stackOptionsByLocale = mapSupportedLocales(
  () =>
    ({
      contentStyle: { backgroundColor: color.paper },
      header: renderStackHeader,
      headerShadowVisible: false,
    }) satisfies NativeStackNavigationOptions
);

/** Headers of the app's stacks: the app bar on the paper canvas. */
export const stackScreenOptions = (locale: AppLocale) =>
  stackOptionsByLocale[locale];

/**
 * The tabs carry text labels; the bar above the label marks the open tab
 * in place of an icon, which the app doesn't ship.
 */
function TabIndicator({ focused }: { readonly focused: boolean }) {
  return (
    <View
      aria-hidden
      style={[styles.indicator, focused && styles.indicatorFocused]}
    />
  );
}

const tabOptionsByLocale = mapSupportedLocales(
  (locale) =>
    ({
      headerShown: false,
      sceneStyle: { backgroundColor: color.paper },
      tabBarActiveTintColor: color.action,
      tabBarInactiveTintColor: color.ink2,
      tabBarIcon: TabIndicator,
      // The bar holds 49pt: a 28pt icon slot leaves no room for a readable
      // label, so the slot shrinks to the indicator.
      tabBarIconStyle: { height: 3, marginBottom: theme.spacing.xs + 2 },
      tabBarLabelStyle: localeTextStyle(theme.type.captionStrong, locale),
      tabBarStyle: {
        backgroundColor: color.surface,
        borderTopColor: color.line,
      },
    }) satisfies BottomTabNavigationOptions
);

/** The bottom tab bar; each tab's stack draws its own header. */
export const tabScreenOptions = (locale: AppLocale) =>
  tabOptionsByLocale[locale];

const styles = StyleSheet.create({
  header: { backgroundColor: color.paper },
  indicator: {
    backgroundColor: "transparent",
    borderRadius: 2,
    height: 3,
    width: 24,
  },
  indicatorFocused: { backgroundColor: color.action },
});
