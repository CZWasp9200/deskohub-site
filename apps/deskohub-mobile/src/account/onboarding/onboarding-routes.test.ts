import { describe, expect, test } from "bun:test";
import type { NavigationState } from "expo-router/react-navigation";
import {
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

  test("closing goes down to the first step only when there is one below", () => {
    const calls: Array<string> = [];
    const router = (canDismiss: boolean) => ({
      canDismiss: () => canDismiss,
      dismissAll: () => void calls.push("dismissAll"),
      back: () => void calls.push("back"),
    });
    closeOnboarding(router(true));
    closeOnboarding(router(false));
    expect(calls).toEqual(["dismissAll", "back", "back"]);
  });
});
