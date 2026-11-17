import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { SelectField } from "./select-field";
import {
  elementTree,
  find,
  findAll,
  type HostProps,
  hostTree,
} from "./testing/element-tree";
import { color } from "./tokens";

const flat = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

const select = (props: Partial<ComponentProps<typeof SelectField>> = {}) => {
  const onPress = mock(() => undefined);
  const tree = hostTree(
    elementTree(SelectField, { label: "label", onPress, ...props })
  );
  const pressable = find(tree, "Pressable")?.props as HostProps;
  const frame = flat(
    (pressable.style as (state: { pressed: boolean }) => unknown)({
      pressed: false,
    })
  );
  const shown = find(find(tree, "Pressable"), "Text")?.props;
  return { tree, pressable, frame, shown, onPress };
};

describe("SelectField", () => {
  test("is a button named by its label that opens the picker", () => {
    const { pressable, onPress } = select();
    expect(pressable.role).toBe("button");
    expect(pressable["aria-label"]).toBe("label");
    (pressable.onPress as () => void)();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("shows the value, read as the field's value, with a chevron", () => {
    const { tree, pressable, shown } = select({ value: "v", placeholder: "p" });
    expect(shown?.children).toBe("v");
    expect(flat(shown?.style).color).toBe(color.navy);
    expect(pressable.accessibilityValue).toEqual({ text: "v" });
    expect(find(find(tree, "Pressable"), "Svg")).toBeDefined();
  });

  test("without a value shows the placeholder in ink3, with no value read", () => {
    const { pressable, shown } = select({ placeholder: "p" });
    expect(shown?.children).toBe("p");
    expect(flat(shown?.style).color).toBe(color.ink3);
    expect(pressable.accessibilityValue).toBeUndefined();
  });

  test("draws the 52 dp field frame", () => {
    expect(select().frame).toMatchObject({
      minHeight: 52,
      borderRadius: 14,
      borderColor: color.field,
    });
  });

  test("an error rings the frame crimson, replaces the hint and describes it", () => {
    const { tree, pressable, frame } = select({ hint: "h", error: "x" });
    expect(frame).toMatchObject({ borderColor: color.danger, borderWidth: 2 });
    expect(pressable["aria-invalid"]).toBe(true);
    expect(pressable.accessibilityHint).toBe("x");
    const region = findAll(tree, "Text").find(
      (text) => text.props.role === "status"
    );
    expect(region?.props.children).toBe("x");
    expect(pressable["aria-describedby"]).toBe(region?.props.id);
  });

  test("disabled is greyed, marked and not pressable", () => {
    const { pressable, frame } = select({ disabled: true });
    expect(pressable.disabled).toBe(true);
    expect(pressable["aria-disabled"]).toBe(true);
    expect(frame.backgroundColor).toBe(color.disabledField);
  });
});
