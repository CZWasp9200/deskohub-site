import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { elementTree, find } from "../ui/testing/element-tree";
import { AppSignInLayout } from "./app-sign-in-layout";
import { AppSignInLinkStep } from "./app-sign-in-link-step";
import { SignInResend } from "./sign-in-resend";
import { SignInStepMessage } from "./sign-in-step-message";
import { inEnglish } from "./testing/sign-in-step-tree";

const step = (props: Partial<Parameters<typeof AppSignInLinkStep>[0]> = {}) => {
  const layout = elementTree(
    AppSignInLinkStep,
    {
      email: testEmailAddress("link"),
      notice: undefined,
      resendAvailableAt: Date.now() + 28_000,
      onResend: () => undefined,
      resending: false,
      onUseDifferentEmail: () => undefined,
      ...props,
    },
    inEnglish
  ) as ReactElement<Parameters<typeof AppSignInLayout>[0]>;
  expect(layout.type).toBe(AppSignInLayout);
  return layout.props;
};

describe("AppSignInLinkStep", () => {
  test("names the link to open, waits to resend it, and has no bottom action", () => {
    const layout = step();
    expect(layout.action).toBeUndefined();
    expect(layout.instructions).toBeDefined();
    expect(layout.onUseDifferentEmail).toBeDefined();
    expect(
      find(<View>{layout.children as ReactNode}</View>, SignInResend)?.props
        .what
    ).toBe("link");
  });

  test("a new link sent, or a refused one, shows in place", () => {
    const notice = { tone: "positive", text: "sent" } as const;
    expect(
      find(
        <View>{step({ notice }).children as ReactNode}</View>,
        SignInStepMessage
      )?.props.notice
    ).toEqual(notice);
  });

  test("starting over waits while a link is sent", () => {
    expect(step({ resending: true }).useDifferentEmailDisabled).toBe(true);
  });
});
