import type { Href, ImperativeRouter } from "expo-router";
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
