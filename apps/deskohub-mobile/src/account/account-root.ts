import type { Href, ImperativeRouter } from "expo-router";
import type { BottomTabNavigationOptions } from "expo-router/tabs";

/** The Account tab's root: its index, the list of sections. */
export const accountRootHref = "/account" as const satisfies Href;

/**
 * Leaves an Account section for the Account root, such as after "Continue"
 * on a completed profile: back down the Account stack to its index, which
 * the stack's anchor keeps below every section, so the root shows no back
 * arrow. Not a replace: that swaps the section for a second index above
 * the anchored one, with a back arrow to the first.
 */
export const returnToAccountRoot = (
  router: Pick<ImperativeRouter, "dismissTo">
) => router.dismissTo(accountRootHref);

/**
 * The Account stack's anchor: its root, which Expo Router puts under a
 * section that opens the stack, so the section shows Back to the root.
 */
export const accountStackAnchor = "index";

/**
 * The Account tab's stack mounts with the tabs instead of on its first visit
 * (#1345). Expo Router puts a stack's anchor under the target only for the
 * link that starts the app (and a `withAnchor` navigation). A link that
 * arrives while the app runs creates a missing stack with the linked section
 * alone, but it pushes onto a stack that is already mounted, above the
 * root. The root screen itself renders on its first visit
 * (`useScreenVisited`), so start-up and the other tabs behave as before.
 */
export const accountTabOptions = {
  lazy: false,
} as const satisfies BottomTabNavigationOptions;
