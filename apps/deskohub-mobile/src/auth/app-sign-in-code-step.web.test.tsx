import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import Mail from "lucide-react-native/icons/mail";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/controls";
import { elementTree, find } from "../ui/testing/element-tree";
import { AppSignInCodeStep } from "./app-sign-in-code-step.web";
import { AppSignInLayout } from "./app-sign-in-layout";
import { SignInCodeInput } from "./sign-in-code-input.web";
import { SignInResend } from "./sign-in-resend";
import { SignInStepMessage } from "./sign-in-step-message";
import { inEnglish } from "./testing/sign-in-step-tree";

type Props = Parameters<typeof AppSignInCodeStep>[0];

const later = () => Date.now() + 30_000;

const step = (props: Partial<Props> = {}) => {
  const layout = elementTree(
    AppSignInCodeStep,
    {
      email: testEmailAddress("code"),
      code: "",
      onCodeChange: () => undefined,
      onSubmit: () => undefined,
      checking: false,
      invalid: false,
      exhausted: false,
      notice: undefined,
      resendAvailableAt: later(),
      onResend: () => undefined,
      resending: false,
      onUseDifferentEmail: () => undefined,
      ...props,
    },
    inEnglish
  ) as ReactElement<Parameters<typeof AppSignInLayout>[0]>;
  expect(layout.type).toBe(AppSignInLayout);
  const middle = <>{layout.props.children as ReactNode}</>;
  const action = layout.props.action as ReactElement<
    Parameters<typeof Button>[0]
  >;
  expect(action.type).toBe(Button);
  return {
    layout: layout.props,
    input: find(middle, SignInCodeInput)?.props,
    message: find(middle, SignInStepMessage)?.props,
    resend: find(middle, SignInResend)?.props,
    action: action.props,
  };
};

describe("AppSignInCodeStep", () => {
  test("on load: the boxes take the code, Sign in waits for six digits, and the resend wait shows", () => {
    const { layout, input, resend, action } = step();
    expect(input?.disabled).toBe(false);
    expect(input?.invalid).toBe(false);
    expect(action.disabled).toBe(true);
    expect(action.busy).toBe(false);
    expect(action.icon).toBeUndefined();
    expect(resend?.countdownOnly).toBe(false);
    expect(resend?.what).toBe("code");
    // "Use a different email" sits with the instructions, not the action.
    expect(layout.onUseDifferentEmail).toBeDefined();
  });

  test("Sign in is enabled once all six digits are in, and submits them", () => {
    const onSubmit = mock((_code: string) => undefined);
    expect(step({ code: "73104" }).action.disabled).toBe(true);
    const { action, input } = step({ code: "731044", onSubmit });
    expect(action.disabled).toBe(false);
    action.onPress();
    expect(onSubmit).toHaveBeenCalledWith("731044");
    // The sixth digit submits on its own, as on the site.
    expect(input?.onComplete).toBe(onSubmit);
  });

  test("while the code is checked the action is busy and the boxes lock", () => {
    const { input, action, layout } = step({ code: "731044", checking: true });
    expect(action.busy).toBe(true);
    expect(action.disabled).toBe(false);
    expect(input?.disabled).toBe(true);
    expect(layout.useDifferentEmailDisabled).toBe(true);
  });

  test("a wrong code rings the boxes and says so under them", () => {
    const notice = { tone: "error", text: "wrong" } as const;
    const { input, message } = step({ code: "481920", invalid: true, notice });
    expect(input?.invalid).toBe(true);
    expect(input?.disabled).toBe(false);
    expect(message?.notice).toEqual(notice);
    expect(message?.id).toBe(input?.describedBy);
  });

  test("a new code sent is confirmed under the boxes", () => {
    const notice = { tone: "positive", text: "sent" } as const;
    expect(step({ notice }).message?.notice).toEqual(notice);
  });

  test("while a new code is sent, the boxes lock and Sign in waits", () => {
    const { input, action, resend } = step({ code: "731044", resending: true });
    expect(input?.disabled).toBe(true);
    expect(action.disabled).toBe(true);
    expect(resend?.busy).toBe(true);
  });

  test("after too many wrong codes the boxes lock and the action sends a new code", () => {
    const onResend = mock(() => undefined);
    const { input, action, resend } = step({
      exhausted: true,
      resendAvailableAt: Date.now() - 1,
      onResend,
    });
    expect(input?.disabled).toBe(true);
    expect(action.icon).toBe(Mail);
    expect(action.disabled).toBe(false);
    action.onPress();
    expect(onResend).toHaveBeenCalledTimes(1);
    // The bottom action resends, so only a wait would show in the middle.
    expect(resend?.countdownOnly).toBe(true);
  });

  test("after too many wrong codes, a new code waits for the server", () => {
    const { action } = step({ exhausted: true, resendAvailableAt: later() });
    expect(action.icon).toBe(Mail);
    expect(action.disabled).toBe(true);
  });
});
