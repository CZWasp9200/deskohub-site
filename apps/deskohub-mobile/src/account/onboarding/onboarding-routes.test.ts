import { describe, expect, test } from "bun:test";
import type { NavigationState } from "expo-router/react-navigation";
import {
  aboutYouBelow,
  closeOnboarding,
  finishOnboardingAt,
  finishOnlyState,
  onboardingFinishRoute,
} from "./onboarding-routes";

const steps: NavigationState = {
  key: "onboarding-stack",
  index: 1,
  routeKeySeq: 2,
  routeNames: ["index", "billing", onboardingFinishRoute],
  routes: [
    { key: "index-1", name: "index", params: {} },
    { key: "billing-2", name: "billing", params: {} },
  ],
  stale: false,
  type: "stack",
};

describe("onboarding routes", () => {
  test("the finish replaces every step of the same stack", () => {
    const finish = finishOnlyState(steps);
    expect(finish).toMatchObject({
      key: steps.key,
      routeNames: steps.routeNames,
      type: "stack",
      stale: false,
      index: 0,
    });
    expect(finish.routes.map((route) => route.name)).toEqual([
      onboardingFinishRoute,
    ]);
    expect(steps.routes.map((route) => route.key)).not.toContain(
      finish.routes[0]?.key
    );
    expect(finish.routeKeySeq).toBeGreaterThan(steps.routeKeySeq);
  });

  test("each finish action leaves for its tab's root", () => {
    const visited: Array<unknown> = [];
    const router = { dismissTo: (href: unknown) => void visited.push(href) };
    finishOnboardingAt(router, "book");
    finishOnboardingAt(router, "reservations");
    expect(visited).toEqual(["/book", "/reservations"]);
  });

  test("About you is below Billing details only inside the onboarding stack", () => {
    expect(aboutYouBelow(steps, "billing-2")).toBe(true);
    // Billing details opened on its own, above a tab with its own history.
    const direct = { routes: [{ key: "billing-1", name: "billing" }] };
    expect(aboutYouBelow(direct, "billing-1")).toBe(false);
    expect(aboutYouBelow(steps, "index-1")).toBe(false);
  });

  test("closing takes the whole onboarding stack off its navigator", () => {
    const calls: Array<string> = [];
    const router = {
      replace: (href: unknown) => void calls.push(`replace ${href}`),
    };
    const screen = (canGoBack: boolean) => ({
      getParent: () => ({
        canGoBack: () => canGoBack,
        goBack: () => void calls.push("parent back"),
      }),
    });
    // Opened over a tab: the tab's screen comes back.
    closeOnboarding(screen(true), router);
    // Opened by a link with nothing below: the app's start.
    closeOnboarding(screen(false), router);
    expect(calls).toEqual(["parent back", "replace /"]);
  });
});
