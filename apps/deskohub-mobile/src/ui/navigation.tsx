import { mapSupportedLocales } from "@deskohub/i18n/locale-registry";
import {
  type Href,
  type NativeStackHeaderProps,
  type NativeStackNavigationOptions,
  useRouter,
} from "expo-router";
import { getHeaderTitle } from "expo-router/react-navigation";
import type { BottomTabNavigationOptions } from "expo-router/tabs";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLocale } from "../i18n/app-locale";
import { useBackFallback } from "../routing/back-fallback";
import { AppBar } from "./app-bar";
import { FocusedStatusBar } from "./focused-status-bar";
import { color } from "./tokens";
import { type ContentWidth, useContentColumn, useViewport } from "./viewport";

// Options are one object per locale, so a navigator sees the same options
// until the locale changes. The stack header is the app's own `AppBar`,
// whose Text follows the locale.

/**
 * A stack screen's header: the app bar below the top safe area, with a
 * back arrow when there is a screen to go back to, or a `backFallback` to
 * open in its place (unless the screen turns it off with
 * `headerBackVisible: false`), the screen's `headerRight` actions, and the
 * hairline when it sets `headerShadowVisible`. The status bar's content is
 * dark on the paper canvas.
 */
export function StackHeader({
  back,
  options,
  route,
  navigation,
  closes = false,
  tone = "paper",
  backFallback,
  contentWidth,
}: NativeStackHeaderProps & {
  /** The screen ends a flow: its button closes it rather than going back. */
  readonly closes?: boolean;
  /** A navy header over a screen whose top is navy (`AppBar`'s `tone`). */
  readonly tone?: "paper" | "navy";
  /**
   * Where Back goes, the arrow and Android's back, when nothing in the app
   * is behind the screen, as when a link opened it on a cold start
   * (`useBackFallback`).
   */
  readonly backFallback?: Href;
  readonly contentWidth?: ContentWidth;
}) {
  const insets = useSafeAreaInsets();
  const { isWide } = useViewport();
  const column = useContentColumn(contentWidth);
  const router = useRouter();
  useBackFallback(navigation, backFallback);
  const canGoBack = back !== undefined;
  const openFallback =
    backFallback === undefined ? undefined : () => router.replace(backFallback);
  const goBack = canGoBack ? () => navigation.goBack() : openFallback;
  return (
    <View
      style={[
        styles.header,
        tone === "navy" && styles.navyHeader,
        { paddingTop: insets.top },
      ]}
    >
      <FocusedStatusBar style={tone === "navy" ? "light" : "dark"} />
      <View style={isWide ? column : undefined}>
        <AppBar
          title={getHeaderTitle(options, route.name)}
          onBack={options.headerBackVisible === false ? undefined : goBack}
          actions={options.headerRight?.({
            tintColor: tone === "navy" ? color.white : color.navy,
            canGoBack,
          })}
          raised={options.headerShadowVisible === true}
          back={closes ? "close" : "back"}
          tone={tone}
        />
      </View>
    </View>
  );
}

const renderStackHeader = (props: NativeStackHeaderProps) => (
  <StackHeader {...props} />
);

/** A stack header whose button closes the screen (`StackHeader`'s `closes`). */
export const renderClosingStackHeader = (props: NativeStackHeaderProps) => (
  <StackHeader {...props} closes />
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

/** The tabs' scenes; each tab's stack draws its own header, `TabBar` the bar. */
export const tabScreenOptions = {
  headerShown: false,
  sceneStyle: { backgroundColor: color.paper },
} as const satisfies BottomTabNavigationOptions;

const styles = StyleSheet.create({
  header: { backgroundColor: color.paper },
  navyHeader: { backgroundColor: color.navy },
});
