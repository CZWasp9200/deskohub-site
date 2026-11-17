import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { color } from "../ui/tokens";
import { SignInCodeInput } from "./sign-in-code-input.web";
import { inOrder, shownTree } from "./testing/sign-in-step-tree";

type Props = Parameters<typeof SignInCodeInput>[0];

const shown = (props: Partial<Props> = {}) =>
  inOrder(
    shownTree(SignInCodeInput, {
      value: "",
      onChange: () => undefined,
      label: "code",
      ...props,
    }) as ReactNode
  );

const boxesOf = (elements: ReturnType<typeof shown>) =>
  elements.filter(({ props }) => "data-code-box" in props);

const ringOf = (box: ReturnType<typeof shown>[number]) =>
  (box.props.style as { boxShadow: string }).boxShadow;

describe("SignInCodeInput", () => {
  test("shows six boxes, three and three around a dash", () => {
    const elements = shown({ value: "7310" });
    const boxes = boxesOf(elements);
    expect(boxes).toHaveLength(6);
    const dash = elements.findIndex(
      ({ type, props }) => type === "span" && props["aria-hidden"] === "true"
    );
    expect(elements.indexOf(boxes[2] as never)).toBeLessThan(dash);
    expect(elements.indexOf(boxes[3] as never)).toBeGreaterThan(dash);
    expect(boxes.flatMap(({ props }) => props.children as never)).toEqual(
      expect.arrayContaining(["7", "3", "1", "0"])
    );
  });

  test("one input takes the code: numeric, with the one-time-code suggestion", () => {
    const input = shown({ describedBy: "message" }).find(
      ({ type }) => type === "input"
    );
    expect(input?.props.inputMode).toBe("numeric");
    expect(input?.props.autoComplete).toBe("one-time-code");
    expect(input?.props.maxLength).toBe(6);
    expect(input?.props.autoFocus).toBe(true);
    expect(input?.props["aria-label"]).toBe("code");
    expect(input?.props["aria-describedby"]).toBe("message");
  });

  test("an invalid code rings every box in the error colour", () => {
    const boxes = boxesOf(shown({ value: "481920", invalid: true }));
    expect(boxes.every((box) => ringOf(box).includes(color.danger))).toBe(true);
    expect(
      shown({ invalid: true }).find(({ type }) => type === "input")?.props[
        "aria-invalid"
      ]
    ).toBe(true);
  });

  test("disabled boxes are greyed and take no input", () => {
    const elements = shown({ disabled: true });
    expect(elements.find(({ type }) => type === "input")?.props.disabled).toBe(
      true
    );
    for (const box of boxesOf(elements)) {
      expect(
        (box.props.style as { backgroundColor: string }).backgroundColor
      ).toBe(color.disabledField);
    }
  });
});
