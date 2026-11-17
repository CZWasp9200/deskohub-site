import { describe, expect, test } from "bun:test";
import { Children, createElement, type ReactElement } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { BottomSheet, sheetBottomInset } from "./bottom-sheet";
import { elementTree, find, findAll, flatStyle } from "./testing/element-tree";
import { Text } from "./text";
import { color, radius, space } from "./tokens";

const dismiss = () => undefined;

const sheet = (props: Partial<Parameters<typeof BottomSheet>[0]> = {}) =>
  elementTree(
    BottomSheet,
    {
      visible: true,
      title: "title",
      onDismiss: dismiss,
      children: createElement("Content"),
      ...props,
    },
    (component) =>
      createElement(
        SafeAreaInsetsContext.Provider,
        { value: { top: 30, right: 0, bottom: 20, left: 0 } },
        component
      )
  );

/** The sheet: the element carrying the dialog role. */
const panel = (tree: ReturnType<typeof sheet>) =>
  findAll(tree, "Animated.View").find((view) => view.props.role === "dialog");

describe("BottomSheet", () => {
  test("a transparent modal, up only while visible, that the back button dismisses", () => {
    const modal = find(sheet(), "Modal")?.props;
    expect(modal?.visible).toBe(true);
    expect(modal?.transparent).toBe(true);
    expect(modal?.onRequestClose).toBe(dismiss);
    expect(find(sheet({ visible: false }), "Modal")?.props.visible).toBe(false);
  });

  test("a tap on the navy scrim dismisses", () => {
    const scrim = find(sheet(), "Pressable")?.props;
    expect(scrim?.onPress).toBe(dismiss);
    expect(flatStyle(scrim?.style)).toMatchObject({
      backgroundColor: color.scrim,
    });
  });

  test("a white modal sheet, rounded on top, clear of the bottom safe area", () => {
    const props = panel(sheet())?.props;
    expect(props?.["aria-modal"]).toBe(true);
    expect(props?.["aria-label"]).toBe("title");
    expect(flatStyle(props?.style)).toMatchObject({
      backgroundColor: color.surface,
      borderTopLeftRadius: radius.overlay,
      borderTopRightRadius: radius.overlay,
      paddingBottom: 20 + space.sm,
    });
  });

  test("a grab handle, the title as a heading, then the scrolling content", () => {
    const children = Children.toArray(
      panel(sheet())?.props.children
    ) as ReactElement<Record<string, unknown>>[];
    expect(children.map((child) => child.type)).toEqual([
      "View",
      Text,
      "ScrollView",
    ]);
    expect(children[0]?.props["aria-hidden"]).toBe(true);
    expect(flatStyle(children[0]?.props.style)).toMatchObject({
      width: 32,
      height: 4,
      backgroundColor: color.handle,
    });
    expect(children[1]?.props).toMatchObject({
      role: "heading",
      variant: "title",
    });
    expect(find(children[2], "Content")).toBeDefined();
  });

  test("a header stays between the title and the scrolling content", () => {
    const children = Children.toArray(
      panel(sheet({ header: createElement("Search") }))?.props.children
    ) as ReactElement<Record<string, unknown>>[];
    expect(children.map((child) => child.type)).toEqual([
      "View",
      Text,
      "View",
      "ScrollView",
    ]);
    expect(find(children[2], "Search")).toBeDefined();
    expect(find(children[3], "Search")).toBeUndefined();
  });

  test("a tap on the content acts while the keyboard is up", () => {
    expect(find(sheet(), "ScrollView")?.props.keyboardShouldPersistTaps).toBe(
      "handled"
    );
  });

  test("the sheet's bottom clears the keyboard while it's up, else the safe area", () => {
    expect(sheetBottomInset({ safeAreaBottom: 20, keyboardHeight: 0 })).toBe(
      20 + space.sm
    );
    expect(sheetBottomInset({ safeAreaBottom: 20, keyboardHeight: 300 })).toBe(
      300 + space.sm
    );
  });

  test("without a title the content follows the handle", () => {
    expect(find(sheet({ title: undefined }), Text)).toBeUndefined();
  });
});
