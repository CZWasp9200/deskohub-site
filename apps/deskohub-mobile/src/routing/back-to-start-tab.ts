import { useIsFocused, useNavigation, useRoute } from "expo-router";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";
import type { StartTab } from "./start-tab";

/** The part of the tab navigator's state that system back reads. */
export interface TabsBackState {
  readonly key: string;
  readonly index: number;
  readonly routes: ReadonlyArray<{
    readonly name: string;
    /** The tab's own stack, once it has one. */
    readonly state?: { readonly index?: number };
  }>;
}

/**
 * Where system back goes from the tabs: from the root of a tab other than
 * the start tab, to the start tab; anywhere else it is not the tabs' call
 * (a tab's stack goes back first, and back from the start tab's root
 * leaves the app).
 */
export const backToStartTab = (
  tabs: TabsBackState,
  startTab: StartTab
): StartTab | undefined => {
  const open = tabs.routes[tabs.index];
  if (open === undefined || open.name === startTab) return undefined;
  return (open.state?.index ?? 0) === 0 ? startTab : undefined;
};

/**
 * Android's back button and gesture on the tabs: back from another tab's
 * root returns to the start tab, then leaves the app (board 20). The tab
 * navigator's own back is off (`backBehavior="none"`), since its initial
 * route can't follow a start tab decided at launch. Used by the tabs layout
 * while the tabs are in front; registered after the navigation container's
 * handler, so it is asked first.
 */
export const useBackToStartTab = (startTab: StartTab | undefined) => {
  const navigation = useNavigation();
  const { key } = useRoute();
  const focused = useIsFocused();
  useEffect(() => {
    // Only Android has a system back; the web's is the browser's history.
    if (Platform.OS !== "android" || !focused || startTab === undefined) {
      return;
    }
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        const tabs = navigation
          .getState()
          ?.routes.find((route) => route.key === key)?.state as
          | TabsBackState
          | undefined;
        const target =
          tabs === undefined ? undefined : backToStartTab(tabs, startTab);
        if (tabs === undefined || target === undefined) return false;
        navigation.dispatch({
          type: "JUMP_TO",
          payload: { name: target },
          target: tabs.key,
        });
        return true;
      }
    );
    return () => subscription.remove();
  }, [focused, startTab, navigation, key]);
};
