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
 * Whether About you sits below the step `key` in the onboarding stack's own
 * state, so Back reaches it. Billing details opened on its own has nothing
 * below it here, whatever the stacks around onboarding hold.
 */
export const aboutYouBelow = (
  stack: Pick<NavigationState, "routes">,
  key: string
) => {
  const at = stack.routes.findIndex((route) => route.key === key);
  return stack.routes
    .slice(0, Math.max(at, 0))
    .some((route) => route.name === "index");
};

/** The navigation of a screen inside onboarding, as closing reads it. */
export interface OnboardingScreenNavigation {
  readonly getParent: () =>
    | { readonly canGoBack: () => boolean; readonly goBack: () => void }
    | undefined;
}

/**
 * Leaves onboarding for the screen it opened over: the navigator that holds
 * the onboarding stack takes the whole stack off. With nothing below it (a
 * link straight into onboarding) the app's start replaces it.
 */
export const closeOnboarding = (
  navigation: OnboardingScreenNavigation,
  router: Pick<ImperativeRouter, "replace">
) => {
  const parent = navigation.getParent();
  if (parent?.canGoBack()) parent.goBack();
  else router.replace("/");
};

/**
 * A finish action: out of onboarding to the root of `tab` (Book a
 * workspace, Go to reservations), past whatever its stack had open.
 */
export const finishOnboardingAt = (
  router: Pick<ImperativeRouter, "dismissTo">,
  tab: StartTab
) => router.dismissTo(startTabHref[tab]);
