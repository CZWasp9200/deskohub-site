import { describe, expect, mock, test } from "bun:test";
import { Button } from "../ui/controls";
import { elementTree, find } from "../ui/testing/element-tree";
import { SignInResend } from "./sign-in-resend";
import { inEnglish } from "./testing/sign-in-step-tree";

type Props = Parameters<typeof SignInResend>[0];

const resend = (props: Partial<Props> = {}) =>
  elementTree(
    SignInResend,
    {
      availableAt: Date.now() + 28_000,
      what: "code",
      onResend: () => undefined,
      busy: false,
      ...props,
    },
    inEnglish
  );

describe("SignInResend", () => {
  test("counts down while another email has to wait", () => {
    const tree = resend();
    expect(find(tree, Button)).toBeUndefined();
    expect(find(tree, "View")?.props.role).toBe("timer");
  });

  test("offers the email as a text action once the wait is over", () => {
    const onResend = mock(() => undefined);
    const button = find(
      resend({ availableAt: Date.now() - 1, onResend }),
      Button
    )?.props;
    expect(button?.variant).toBe("text");
    button?.onPress();
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  test("the action shows progress while the email is sent", () => {
    expect(
      find(resend({ availableAt: Date.now() - 1, busy: true }), Button)?.props
        .busy
    ).toBe(true);
  });

  test("the link-only page counts down the same way", () => {
    expect(find(resend({ what: "link" }), "View")?.props.role).toBe("timer");
    expect(
      find(resend({ what: "link", availableAt: Date.now() - 1 }), Button)
    ).toBeDefined();
  });

  test("when the page's main action resends, only the wait shows", () => {
    expect(
      resend({ countdownOnly: true, availableAt: Date.now() - 1 })
    ).toBeNull();
    expect(find(resend({ countdownOnly: true }), "View")?.props.role).toBe(
      "timer"
    );
  });
});
