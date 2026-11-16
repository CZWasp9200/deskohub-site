import { describe, expect, mock, test } from "bun:test";
import {
  elementTree,
  find,
  findAll,
  flatStyle,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { color, touchTarget } from "../../ui/tokens";
import { Stepper } from "./stepper";

const props = (
  overrides: Partial<Parameters<typeof Stepper>[0]> = {}
): Parameters<typeof Stepper>[0] => ({
  label: "Seats",
  value: 2,
  min: 1,
  max: 6,
  onChange: () => undefined,
  decrementLabel: "One fewer",
  incrementLabel: "One more",
  ...overrides,
});

const stepper = (overrides: Partial<Parameters<typeof Stepper>[0]> = {}) =>
  hostTree(elementTree(Stepper, props(overrides)));

const buttons = (tree: ReturnType<typeof stepper>) =>
  findAll(tree, "Pressable");

describe("Stepper", () => {
  test("is one adjustable control that announces its hint with the value", () => {
    const control = find(stepper({ hint: "Up to 6" }), "View");

    expect(control?.props.accessibilityRole).toBe("adjustable");
    expect(control?.props.accessibilityLabel).toBe("Seats");
    expect(control?.props.accessibilityValue).toMatchObject({
      min: 1,
      max: 6,
      now: 2,
    });
    const { text } = control?.props.accessibilityValue as { text: string };
    expect(text).toContain("Up to 6");
    expect(text).toContain("2");
  });

  test("draws the hint under the label, in warning ink at a limit", () => {
    const hintOf = (tone: "muted" | "warning") =>
      findAll(stepper({ hint: "6", hintTone: tone, value: 6 }), "Text").find(
        (text) => textOf(text) === "6" && text.props.numeric !== true
      );

    expect(flatStyle(hintOf("muted")?.props.style).color).toBe(color.ink2);
    expect(flatStyle(hintOf("warning")?.props.style).color).toBe(
      color.warningInk
    );
  });

  test("without a hint the label stands alone", () => {
    const texts = findAll(stepper(), "Text").map(textOf);

    expect(texts).toEqual(["Seats", "2"]);
  });

  test("its round buttons are full touch targets and stop at the limits", () => {
    const onChange = mock((_value: number) => undefined);
    const [minus, plus] = buttons(stepper({ value: 6, onChange }));
    const styleOf = minus?.props.style as (state: {
      pressed: boolean;
    }) => unknown;
    const look = flatStyle(styleOf({ pressed: false }));

    expect(look.width).toBe(touchTarget);
    expect(look.borderRadius).toBe(touchTarget / 2);
    expect(minus?.props.disabled).toBe(false);
    expect(plus?.props.disabled).toBe(true);
    (minus?.props.onPress as () => void)();
    expect(onChange).toHaveBeenCalledWith(5);
  });

  test("a range with nothing to choose disables both buttons", () => {
    expect(
      buttons(stepper({ value: 1, max: 0 })).map((b) => b.props.disabled)
    ).toEqual([true, true]);
  });
});
