import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { Checkbox, CheckboxRow } from "./checkbox";
import { listRowLayout } from "./list-row-layout";
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

const box = (props: ComponentProps<typeof Checkbox>) => {
  const tree = hostTree(elementTree(Checkbox, props));
  return { view: find(tree, "View")?.props, check: find(tree, "Svg") };
};

describe("Checkbox", () => {
  test("is a 22 dp box hidden from assistive tech", () => {
    const { view } = box({ checked: false });
    expect(view?.["aria-hidden"]).toBe(true);
    expect(flat(view?.style)).toMatchObject({
      width: 22,
      height: 22,
      borderRadius: 6,
      borderColor: color.field,
      backgroundColor: color.surface,
    });
  });

  test("checked fills orange with a check; danger fills crimson", () => {
    const on = box({ checked: true });
    expect(flat(on.view?.style).backgroundColor).toBe(color.action);
    expect(on.check).toBeDefined();
    expect(
      flat(box({ checked: true, tone: "danger" }).view?.style).backgroundColor
    ).toBe(color.danger);
    expect(box({ checked: false }).check).toBeUndefined();
  });

  test("disabled is neutral grey, checked or not", () => {
    expect(
      flat(box({ checked: true, disabled: true }).view?.style).backgroundColor
    ).toBe(color.disabled);
    expect(
      flat(box({ checked: false, disabled: true }).view?.style).borderColor
    ).toBe(color.disabled);
  });
});

const row = (props: Partial<ComponentProps<typeof CheckboxRow>> = {}) => {
  const onChange = mock((_checked: boolean) => undefined);
  const tree = hostTree(
    elementTree(CheckboxRow, {
      label: "label",
      checked: false,
      onChange,
      ...props,
    })
  );
  const pressable = find(tree, "Pressable")?.props as HostProps;
  return { tree, pressable, onChange };
};

describe("CheckboxRow", () => {
  test("the whole row is the checkbox, named by its text", () => {
    const { tree, pressable } = row({ description: "more", checked: true });
    expect(findAll(tree, "Pressable")).toHaveLength(1);
    expect(pressable.role).toBe("checkbox");
    expect(pressable["aria-checked"]).toBe(true);
    expect(pressable["aria-label"]).toBeUndefined();
    expect(findAll(tree, "Text")).toHaveLength(2);
  });

  test("pressing the row toggles it", () => {
    const { pressable, onChange } = row({ checked: false });
    (pressable.onPress as () => void)();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("disabled is marked and not pressable", () => {
    const { pressable } = row({ disabled: true });
    expect(pressable["aria-disabled"]).toBe(true);
    expect(pressable.disabled).toBe(true);
  });

  test("shares the list row layout, the box on the label's first line", () => {
    const { pressable } = row();
    const style = flat(
      (pressable.style as (state: { pressed: boolean }) => unknown)({
        pressed: false,
      })
    );
    expect(style).toMatchObject({
      ...flat(listRowLayout.row),
      alignItems: "flex-start",
    });
  });
});
