import type { Href, ImperativeRouter } from "expo-router";
import type { NavigationState } from "expo-router/react-navigation";
import { type StartTab, startTabHref } from "../../routing/start-tab";

/**
 * Completing the profile, in a stack above the tabs (like booking), so it
 * opens over the tab the customer is on and closes back to it.
 */
export const onboardingHref = "/onboarding" as const satisfies Href;

/** The second step, Billing details. */
export const onboardingBillingHref =
  "/onboarding/billing" as const satisfies Href;

/** The finish screen's route name in the onboarding stack. */
export const onboardingFinishRoute = "done";

/**
 * The onboarding stack with the finish as its only screen, in place of the
 * steps, so Back from it leaves onboarding. A reset takes a complete state,
 * so it keeps the stack's own key and route names.
 */
export const finishOnlyState = (stack: NavigationState): NavigationState => ({
  ...stack,
  index: 0,
  routeKeySeq: stack.routeKeySeq + 1,
  routes: [
    {
      key: `${onboardingFinishRoute}:${stack.key}-${stack.routeKeySeq + 1}`,
      name: onboardingFinishRoute,
      params: {},
    },
  ],
  stale: false,
});

/**
 * Leaves onboarding for the screen it opened over: down to the stack's
 * first step, then back out of the stack.
 */
export const closeOnboarding = (
  router: Pick<ImperativeRouter, "canDismiss" | "dismissAll" | "back">
) => {
  if (router.canDismiss()) router.dismissAll();
  router.back();
};

/**
 * A finish action: out of onboarding to the root of `tab` (Book a
 * workspace, Go to reservations), past whatever its stack had open.
 */
export const finishOnboardingAt = (
  router: Pick<ImperativeRouter, "dismissTo">,
  tab: StartTab
) => router.dismissTo(startTabHref[tab]);
