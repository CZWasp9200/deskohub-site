import { expect, mock, test } from "bun:test";
import { Option } from "effect";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import { ProfileSubmitState } from "../profile/profile-save";

mock.module("expo-router", () =>
  expoRouterStandIn({ useFocusEffect: () => undefined })
);

const { ActionFooter } = await import("../../ui/action-footer");
const { elementTree, find, findAll, hostTree } = await import(
  "../../ui/testing/element-tree"
);
const { OnboardingFooter } = await import("./onboarding-footer");
const { OnboardingStepProgress } = await import("./onboarding-step-head");

const invalid = ProfileSubmitState.Invalid({
  invalid: { fields: { firstName: "required" }, first: Option.none() },
  attempt: {},
});

const footer = (state: ProfileSubmitState, wide: boolean) =>
  find(
    elementTree(OnboardingFooter, {
      step: "about-you",
      state,
      shownFields: ["firstName"],
      label: "Continue",
      busyLabel: "Continuing",
      onPress: () => undefined,
      locale: "en-US",
      wide,
    }),
    ActionFooter
  )?.props;

test("wide field errors replace step progress and remain a live status", () => {
  const error = footer(invalid, true);
  expect(error?.message).toBeUndefined();
  expect(find(error?.aside, OnboardingStepProgress)).toBeUndefined();
  const status = findAll(hostTree(error?.aside), "Text").find(
    (text) => text.props.role === "status"
  );
  expect(status?.props).toMatchObject({
    "aria-live": "polite",
    accessibilityLiveRegion: "polite",
    children: "Fix 1 field to continue",
  });

  const cleared = footer(ProfileSubmitState.Idle(), true);
  expect(find(cleared?.aside, OnboardingStepProgress)).toBeDefined();
});

test("compact field errors use the footer's shared announcement", () => {
  const error = footer(invalid, false);
  expect(error?.message).toBe("Fix 1 field to continue");
  expect(error?.aside).toBeUndefined();
});
