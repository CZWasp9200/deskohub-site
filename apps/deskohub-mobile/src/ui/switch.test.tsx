import { describe, expect, mock, test } from "bun:test";
import Bell from "lucide-react-native/icons/bell";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { LoadingIndicator } from "./loading-indicator";
import { Switch, SwitchRow, SwitchTrack, switchLook } from "./switch";
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

const track = (props: ComponentProps<typeof SwitchTrack>) => {
  const tree = elementTree(SwitchTrack, props);
  const views = findAll(hostTree(tree), "View");
  return {
    track: flat(views[0]?.props.style),
    thumb: flat(views[1]?.props.style),
    hidden: views[0]?.props["aria-hidden"],
    check: find(hostTree(tree), "Svg"),
    indicator: find(tree, LoadingIndicator),
  };
};

describe("SwitchTrack", () => {
  test("is a 52 × 32 pill hidden from assistive tech", () => {
    const off = track({ value: false });
    expect(off.hidden).toBe(true);
    expect(off.track).toMatchObject({ width: 52, height: 32 });
  });

  test("off: grey track, field-outlined, small field thumb, no check", () => {
    const off = track({ value: false });
    expect(off.track).toMatchObject({
      backgroundColor: color.disabled,
      borderColor: color.field,
    });
    expect(off.thumb).toMatchObject({
      width: 16,
      backgroundColor: color.field,
    });
    expect(off.check).toBeUndefined();
  });

  test("on: orange track, large white thumb at the end with a check", () => {
    const on = track({ value: true });
    expect(on.track.backgroundColor).toBe(color.action);
    expect(on.thumb).toMatchObject({ width: 24, backgroundColor: color.white });
    // 24 from the track's edge: 22 inside its 2 dp ring.
    expect(on.thumb.left).toBe(22);
    expect(on.check).toBeDefined();
  });

  test("busy shows the loading indicator in place of the check", () => {
    const busy = track({ value: true, busy: true });
    expect(busy.indicator).toBeDefined();
    expect(busy.check).toBeUndefined();
    expect(track({ value: false, busy: true }).thumb.width).toBe(24);
  });

  test("disabled is neutral grey", () => {
    expect(switchLook({ value: true, busy: false, disabled: true })).toEqual({
      track: "disabledOnTrack",
      thumb: "disabledThumbOn",
      glyph: color.disabledInk,
    });
    expect(track({ value: false, disabled: true }).track.backgroundColor).toBe(
      color.disabledField
    );
  });
});

const standalone = (props: Partial<ComponentProps<typeof Switch>> = {}) => {
  const onValueChange = mock((_value: boolean) => undefined);
  const pressable = find(
    hostTree(
      elementTree(Switch, {
        value: false,
        onValueChange,
        accessibilityLabel: "name",
        ...props,
      })
    ),
    "Pressable"
  )?.props as HostProps;
  return { pressable, onValueChange };
};

describe("Switch", () => {
  test("is a named switch with its state and a 48 dp target", () => {
    const { pressable } = standalone({ value: true });
    expect(pressable.role).toBe("switch");
    expect(pressable["aria-label"]).toBe("name");
    expect(pressable["aria-checked"]).toBe(true);
    expect(pressable.hitSlop).toEqual({ top: 8, bottom: 8 });
  });

  test("pressing flips the value", () => {
    const { pressable, onValueChange } = standalone({ value: true });
    (pressable.onPress as () => void)();
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  test("busy is announced and ignores presses", () => {
    const { pressable } = standalone({ busy: true });
    expect(pressable["aria-busy"]).toBe(true);
    expect(pressable.onPress).toBeUndefined();
  });

  test("disabled is marked and not pressable", () => {
    const { pressable } = standalone({ disabled: true });
    expect(pressable["aria-disabled"]).toBe(true);
    expect(pressable.disabled).toBe(true);
  });
});

const switchRow = (props: Partial<ComponentProps<typeof SwitchRow>> = {}) => {
  const onValueChange = mock((_value: boolean) => undefined);
  const tree = hostTree(
    elementTree(SwitchRow, {
      label: "label",
      value: false,
      onValueChange,
      ...props,
    })
  );
  return {
    tree,
    pressable: find(tree, "Pressable")?.props as HostProps,
    onValueChange,
  };
};

describe("SwitchRow", () => {
  test("the whole row is the one switch, named by its text", () => {
    const { tree, pressable } = switchRow({ description: "more" });
    expect(findAll(tree, "Pressable")).toHaveLength(1);
    expect(pressable.role).toBe("switch");
    expect(pressable["aria-checked"]).toBe(false);
    expect(findAll(tree, "Text")).toHaveLength(2);
  });

  test("pressing the row toggles the switch", () => {
    const { pressable, onValueChange } = switchRow({ value: false });
    (pressable.onPress as () => void)();
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  test("busy ignores presses and says so", () => {
    const { pressable } = switchRow({ busy: true });
    expect(pressable["aria-busy"]).toBe(true);
    expect(pressable.onPress).toBeUndefined();
  });

  test("an icon draws in a tile at the start", () => {
    expect(find(switchRow({ icon: Bell }).tree, "Svg")).toBeDefined();
    expect(find(switchRow().tree, "Svg")).toBeUndefined();
  });

  test("matches a list row's metrics, centred", () => {
    const style = flat(
      (switchRow().pressable.style as (state: { pressed: boolean }) => unknown)(
        { pressed: false }
      )
    );
    expect(style).toMatchObject({
      minHeight: 56,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 14,
      alignItems: "center",
    });
  });
});
