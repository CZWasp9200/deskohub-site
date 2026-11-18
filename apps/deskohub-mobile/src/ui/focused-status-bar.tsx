import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

type Foreground = "dark" | "light";
type ObserveStatusBar = (foreground: Foreground) => () => void;

export const StatusBarObserverContext = createContext<
  ObserveStatusBar | undefined
>(undefined);

/** Match Expo's last-mounted status bar when drawing behind its system icons. */
export function useStatusBarForeground() {
  const [bars, setBars] = useState<
    readonly { readonly foreground: Foreground }[]
  >([]);
  const observe = useCallback<ObserveStatusBar>((foreground) => {
    const bar = { foreground };
    setBars((active) => [...active, bar]);
    return () => setBars((active) => active.filter((entry) => entry !== bar));
  }, []);

  return { foreground: bars.at(-1)?.foreground, observe };
}

/**
 * The status bar's content colour while the screen around it has focus:
 * `dark` on the paper canvas, `light` on a navy masthead. The status bar
 * follows the last one mounted, so each mounts only while its screen is in
 * front, and a screen coming back mounts its own again.
 */
export function FocusedStatusBar({ style }: { readonly style: Foreground }) {
  const focused = useIsFocused();
  const observe = useContext(StatusBarObserverContext);
  useLayoutEffect(
    () => (focused ? observe?.(style) : undefined),
    [focused, observe, style]
  );
  return focused ? <StatusBar style={style} /> : null;
}
