import { describe, expect, mock, test } from "bun:test";
import { StyleSheet } from "react-native";
import { ChoiceList } from "./choice-list";
import {
  elementTree,
  find,
  findAll,
  type HostProps,
  hostTree,
} from "./testing/element-tree";
import { color } from "./tokens";

type Value = "a" | "b" | "c";

const list = (disabled?: boolean) => {
  const onSelect = mock((_value: Value) => undefined);
  const tree = hostTree(
    elementTree(ChoiceList<Value>, {
      label: "group",
      choices: [
        { value: "a", label: "A", description: "about a" },
        { value: "b", label: "B" },
        { value: "c", label: "C", disabled: true },
      ],
      selected: "a",
      onSelect,
      disabled,
    })
  );
  return {
    tree,
    group: find(tree, "View")?.props,
    radios: findAll(tree, "Pressable").map((radio) => radio.props),
    onSelect,
  };
};

const resting = (radio: HostProps | undefined) =>
  (StyleSheet.flatten(
    (radio?.style as (state: { pressed: boolean }) => unknown)?.({
      pressed: false,
    }) as never
  ) ?? {}) as Record<string, unknown>;

describe("ChoiceList", () => {
  test("is a named radio group of radio cards with their states", () => {
    const { group, radios } = list();
    expect(group?.role).toBe("radiogroup");
    expect(group?.["aria-label"]).toBe("group");
    expect(radios.map((radio) => radio.role)).toEqual([
      "radio",
      "radio",
      "radio",
    ]);
    expect(radios.map((radio) => radio["aria-checked"])).toEqual([
      true,
      false,
      false,
    ]);
    expect(radios.map((radio) => radio["aria-disabled"])).toEqual([
      false,
      false,
      true,
    ]);
  });

  test("the selected card is outlined orange on the action tint", () => {
    const { radios } = list();
    expect(resting(radios[0])).toMatchObject({
      borderColor: color.action,
      borderWidth: 2,
      backgroundColor: color.actionTint,
      borderRadius: 14,
      minHeight: 56,
    });
    expect(resting(radios[1])).toMatchObject({
      borderColor: color.line,
      borderWidth: 1,
      backgroundColor: color.surface,
    });
    expect(resting(radios[2]).backgroundColor).toBe(color.disabledField);
  });

  test("a description adds a second line", () => {
    const { tree } = list();
    const cards = findAll(tree, "Pressable");
    expect(findAll(cards[0], "Text")).toHaveLength(2);
    expect(findAll(cards[1], "Text")).toHaveLength(1);
  });

  test("pressing a card selects its value", () => {
    const { radios, onSelect } = list();
    (radios[1]?.onPress as (() => void) | undefined)?.();
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  test("a disabled group disables every card", () => {
    expect(list(true).radios.every((radio) => radio.disabled === true)).toBe(
      true
    );
  });
});
