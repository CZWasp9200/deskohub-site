/**
 * The screens inside a tab's stack that hide the tab bar while they show:
 * forms with their own sticky action footer, which the bar would otherwise
 * sit on (boards 12 and 13). Keyed by tab, then by the stack screen's route name.
 */
const screensWithoutTabBar: Readonly<Record<string, ReadonlySet<string>>> = {
  account: new Set(["profile", "billing"]),
};

/**
 * Whether the tab bar steps aside while `focusedScreen` (the focused screen
 * of the tab's own stack, if it has navigated) shows in `tab`.
 */
export const tabBarHidden = (
  tab: string,
  focusedScreen: string | undefined
): boolean =>
  focusedScreen !== undefined &&
  (screensWithoutTabBar[tab]?.has(focusedScreen) ?? false);
