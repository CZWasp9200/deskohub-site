import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { ReactElement, ReactNode } from "react";
import { Button, TextField } from "../ui/controls";
import { elementTree, find } from "../ui/testing/element-tree";
import { AppSignInEmailStep } from "./app-sign-in-email-step";
import { AppSignInLayout } from "./app-sign-in-layout";
import { inEnglish } from "./testing/sign-in-step-tree";

type Props = Parameters<typeof AppSignInEmailStep>[0];

const step = (props: Partial<Props> = {}) => {
  const layout = elementTree(
    AppSignInEmailStep,
    {
      title: "title",
      email: { value: "", locked: false, onChange: () => undefined },
      submitLabel: "submit",
      onSubmit: () => undefined,
      busy: false,
      ...props,
    },
    inEnglish
  ) as ReactElement<Parameters<typeof AppSignInLayout>[0]>;
  expect(layout.type).toBe(AppSignInLayout);
  const field = find(layout.props.children as ReactNode, TextField)?.props;
  const action = (layout.props.action as ReactElement<
    Parameters<typeof Button>[0]
  >) ?? { type: undefined, props: undefined };
  return { layout: layout.props, field, action };
};

describe("AppSignInEmailStep", () => {
  test("the email field is focused on load, with the submit action at the bottom", () => {
    const { layout, field, action } = step();
    expect(field?.autoFocus).toBe(true);
    expect(field?.disabled).toBe(false);
    expect(field?.readOnly).toBe(false);
    expect(field?.placeholder).toBeDefined();
    expect(field?.inputMode).toBe("email");
    expect(action.type).toBe(Button);
    expect(action.props?.label).toBe("submit");
    expect(action.props?.busy).toBe(false);
    // The email step has nothing to start over from.
    expect(layout.onUseDifferentEmail).toBeUndefined();
  });

  test("typing reaches the caller, and the keyboard's send submits", () => {
    const onChange = mock((_value: string) => undefined);
    const onSubmit = mock(() => undefined);
    const { field } = step({
      email: { value: "a", locked: false, onChange },
      onSubmit,
    });
    field?.onChangeText?.("ab");
    field?.onSubmitEditing?.({} as never);
    expect(onChange).toHaveBeenCalledWith("ab");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("while it sends, the action shows progress and the field takes no input", () => {
    const { field, action } = step({ busy: true });
    expect(action.props?.busy).toBe(true);
    expect(field?.disabled).toBe(true);
  });

  test("an error shows at the field", () => {
    expect(step({ error: "error" }).field?.error).toBe("error");
  });

  test("a locked address is read-only and not focused", () => {
    const { field } = step({
      email: {
        value: testEmailAddress("locked"),
        locked: true,
        onChange: () => undefined,
      },
    });
    expect(field?.value).toBe(testEmailAddress("locked"));
    expect(field?.readOnly).toBe(true);
    expect(field?.autoFocus).toBe(false);
  });

  test("the body and illustration are optional", () => {
    const { layout } = step({ body: "body", illustration: <></> });
    expect(layout.instructions).toBe("body");
  });
});
