import { mapSupportedLocales } from "@deskohub/i18n/locale-registry";
import type {
  NativeStackHeaderProps,
  NativeStackNavigationOptions,
} from "expo-router";
import { getHeaderTitle } from "expo-router/react-navigation";
import type { BottomTabNavigationOptions } from "expo-router/tabs";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLocale } from "../i18n/app-locale";
import { AppBar } from "./app-bar";
import { FocusedStatusBar } from "./focused-status-bar";
import { color } from "./tokens";

// Options are one object per locale, so a navigator sees the same options
// until the locale changes. The stack header is the app's own `AppBar`,
// whose Text follows the locale.

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
  closes = false,
}: NativeStackHeaderProps & {
  /** The screen ends a flow: its button closes it rather than going back. */
  readonly closes?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const canGoBack = back !== undefined;
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <FocusedStatusBar style="dark" />
      <AppBar
        title={getHeaderTitle(options, route.name)}
        onBack={
          canGoBack && options.headerBackVisible !== false
            ? () => navigation.goBack()
            : undefined
        }
        actions={options.headerRight?.({ tintColor: color.navy, canGoBack })}
        raised={options.headerShadowVisible === true}
        back={closes ? "close" : "back"}
      />
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
});
