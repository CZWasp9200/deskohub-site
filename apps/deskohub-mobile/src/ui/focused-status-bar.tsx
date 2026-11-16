import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";

/**
 * The status bar's content colour while the screen around it has focus:
 * `dark` on the paper canvas, `light` on a navy masthead. The status bar
 * follows the last one mounted, so each mounts only while its screen is in
 * front, and a screen coming back mounts its own again.
 */
export function FocusedStatusBar({
  style,
}: {
  readonly style: "dark" | "light";
}) {
  return useIsFocused() ? <StatusBar style={style} /> : null;
}
