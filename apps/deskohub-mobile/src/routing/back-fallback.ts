import { type Href, useIsFocused, useRouter } from "expo-router";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

/** The part of a screen's navigation that Back from it reads. */
interface BackNavigation {
  readonly canGoBack: () => boolean;
}

/**
 * Android's back button and gesture on a focused screen with nothing behind
 * it in the app, such as a screen a link opened on a cold start: opens
 * `fallback` in its place instead of leaving the app. With a screen behind
 * it, or without a fallback, the navigator handles back as usual. Registered
 * after the navigation container's handler, so it is asked first.
 */
export const useBackFallback = (
  navigation: BackNavigation,
  fallback: Href | undefined
) => {
  const router = useRouter();
  const focused = useIsFocused();
  useEffect(() => {
    // Only Android has a system back; the web's is the browser's history.
    if (Platform.OS !== "android" || !focused || fallback === undefined) {
      return;
    }
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (navigation.canGoBack()) return false;
        router.replace(fallback);
        return true;
      }
    );
    return () => subscription.remove();
  }, [focused, fallback, navigation, router]);
};
