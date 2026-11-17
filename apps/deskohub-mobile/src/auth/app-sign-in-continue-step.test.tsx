import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { ReactElement } from "react";
import { Button } from "../ui/controls";
import { elementTree, findAll, textOf } from "../ui/testing/element-tree";
import {
  AppSignInContinueStep,
  emailInitials,
} from "./app-sign-in-continue-step";
import { AppSignInLayout } from "./app-sign-in-layout";
import { inEnglish, shownTree } from "./testing/sign-in-step-tree";

type Props = Parameters<typeof AppSignInContinueStep>[0];

const defaults: Props = {
  email: testEmailAddress("jana.novakova"),
  onContinue: () => undefined,
  continuing: false,
  notice: undefined,
  onUseDifferentEmail: () => undefined,
};

describe("AppSignInContinueStep", () => {
  test("shows the account it continues as, with one action back to the app", () => {
    const onContinue = mock(() => undefined);
    const layout = elementTree(
      AppSignInContinueStep,
      { ...defaults, onContinue },
      inEnglish
    ) as ReactElement<Parameters<typeof AppSignInLayout>[0]>;
    expect(layout.type).toBe(AppSignInLayout);
    expect(layout.props.onUseDifferentEmail).toBeDefined();
    const action = layout.props.action as ReactElement<
      Parameters<typeof Button>[0]
    >;
    expect(action.type).toBe(Button);
    expect(action.props.busy).toBe(false);
    action.props.onPress();
    expect(onContinue).toHaveBeenCalledTimes(1);

    const texts = findAll(
      shownTree(AppSignInContinueStep, defaults),
      "Text"
    ).map(textOf);
    // The address may carry a break opportunity before the @.
    expect(texts.map((text) => text.replaceAll("\u200B", ""))).toContain(
      defaults.email
    );
    expect(texts).toContain(emailInitials(defaults.email));
  });

  test("while it hands off, the action is busy", () => {
    const layout = elementTree(
      AppSignInContinueStep,
      { ...defaults, continuing: true },
      inEnglish
    ) as ReactElement<Parameters<typeof AppSignInLayout>[0]>;
    expect(
      (layout.props.action as ReactElement<{ busy: boolean }>).props.busy
    ).toBe(true);
    expect(layout.props.useDifferentEmailDisabled).toBe(true);
  });
});

describe("emailInitials", () => {
  test("takes the first letters of the first two parts before the @", () => {
    expect(emailInitials(testEmailAddress("jana.novakova"))).toBe("JN");
    expect(emailInitials(testEmailAddress("jana_novakova-x"))).toBe("JN");
    expect(emailInitials(testEmailAddress("jana"))).toBe("J");
  });
});
