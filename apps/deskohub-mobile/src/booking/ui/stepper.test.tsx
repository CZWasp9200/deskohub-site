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

// Stand-ins for the caller's words: the stepper shows and announces what
// it is given, so the tests compare against these, never against copy.
const label = "label";
const hint = "hint";

const props = (
  overrides: Partial<Parameters<typeof Stepper>[0]> = {}
): Parameters<typeof Stepper>[0] => ({
  label,
  value: 2,
  min: 1,
  max: 6,
  onChange: () => undefined,
  decrementLabel: "decrement",
  incrementLabel: "increment",
  ...overrides,
});

const stepper = (overrides: Partial<Parameters<typeof Stepper>[0]> = {}) =>
  hostTree(elementTree(Stepper, props(overrides)));

const buttons = (tree: ReturnType<typeof stepper>) =>
  findAll(tree, "Pressable");

describe("Stepper", () => {
  test("is one adjustable control that announces its hint with the value", () => {
    const control = find(stepper({ hint }), "View");
    if (control === undefined) throw new Error("the stepper renders no view");

    expect(control.props.accessibilityRole).toBe("adjustable");
    expect(control.props.accessibilityLabel).toBe(label);
    const value = control.props.accessibilityValue;
    expect(value).toMatchObject({ min: 1, max: 6, now: 2 });
    const text =
      typeof value === "object" && value !== null && "text" in value
        ? value.text
        : undefined;
    if (typeof text !== "string") throw new Error("no announced value text");
    expect(text).toContain(hint);
    expect(text).toContain(String(2));
  });

  test("draws the hint under the label, in warning ink at a limit", () => {
    const hintOf = (tone: "muted" | "warning") =>
      findAll(stepper({ hint, hintTone: tone, value: 6 }), "Text").find(
        (text) => textOf(text) === hint
      );

    expect(flatStyle(hintOf("muted")?.props.style).color).toBe(color.ink2);
    expect(flatStyle(hintOf("warning")?.props.style).color).toBe(
      color.warningInk
    );
  });

  test("without a hint the label stands alone", () => {
    const texts = findAll(stepper(), "Text").map(textOf);

    expect(texts).toEqual([label, String(2)]);
  });

  test("its round buttons are full touch targets and stop at the limits", () => {
    const onChange = mock((_value: number) => undefined);
    const [minus, plus] = buttons(stepper({ value: 6, onChange }));
    if (minus === undefined || plus === undefined) {
      throw new Error("the stepper renders fewer than two buttons");
    }
    const { style, onPress } = minus.props;
    if (typeof onPress !== "function") {
      throw new Error("a step button has no press handler");
    }
    // The resting look: a Pressable's style may be a function of its state.
    const look = flatStyle(
      typeof style === "function" ? style({ pressed: false }) : style
    );

    expect(look.width).toBe(touchTarget);
    expect(look.borderRadius).toBe(touchTarget / 2);
    expect(minus.props.disabled).toBe(false);
    expect(plus.props.disabled).toBe(true);
    onPress();
    expect(onChange).toHaveBeenCalledWith(5);
  });

  test("a range with nothing to choose disables both buttons", () => {
    expect(
      buttons(stepper({ value: 1, max: 0 })).map((b) => b.props.disabled)
    ).toEqual([true, true]);
  });
});
