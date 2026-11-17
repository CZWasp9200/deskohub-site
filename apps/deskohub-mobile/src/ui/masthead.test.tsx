import { describe, expect, mock, test } from "bun:test";
import {
  Children,
  createElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

let focused = true;
mock.module("expo-router", () =>
  expoRouterStandIn({ useIsFocused: () => focused })
);

const { FocusedStatusBar } = await import("./focused-status-bar");
const { Masthead } = await import("./masthead");
const { elementTree, find, flatStyle } = await import("./testing/element-tree");
const { Text } = await import("./text");
const { color, space } = await import("./tokens");

const masthead = (props: Parameters<typeof Masthead>[0]) =>
  elementTree(Masthead, props, (component) =>
    createElement(
      SafeAreaInsetsContext.Provider,
      { value: { top: 24, right: 0, bottom: 0, left: 0 } },
      component
    )
  ) as ReactElement<{ style: unknown; children: ReactNode }>;

describe("Masthead", () => {
  test("a navy band below the status bar, whose content turns light", () => {
    const band = masthead({ title: "title" });
    expect(flatStyle(band.props.style)).toMatchObject({
      backgroundColor: color.navy,
      paddingTop: 24 + space.md,
      paddingHorizontal: space.xl,
    });
    expect(find(band, FocusedStatusBar)?.props.style).toBe("light");
  });

  test("the title is a white display heading", () => {
    expect(find(masthead({ title: "title" }), Text)?.props).toMatchObject({
      variant: "display",
      tone: "inverse",
      role: "heading",
    });
  });

  test("identity content sits above the title, the subtitle below it in muted white", () => {
    const parts = Children.toArray(
      masthead({
        title: "title",
        subtitle: "subtitle",
        children: createElement("Identity"),
      }).props.children
    ) as ReactElement<{ style?: unknown; variant?: string }>[];
    expect(parts.map((part) => part.type)).toEqual([
      FocusedStatusBar,
      "Identity",
      Text,
      Text,
    ]);
    expect(flatStyle(parts[3]?.props.style)).toMatchObject({
      color: color.onNavyMuted,
    });
  });

  test("without a subtitle only the title shows", () => {
    expect(
      Children.toArray(masthead({ title: "title" }).props.children)
    ).toHaveLength(2);
  });
});

describe("FocusedStatusBar", () => {
  test("sets the status bar only while its screen has focus", () => {
    focused = true;
    expect(
      (
        elementTree(FocusedStatusBar, { style: "light" }) as ReactElement<{
          style: string;
        }>
      )?.props.style
    ).toBe("light");
    focused = false;
    expect(elementTree(FocusedStatusBar, { style: "light" })).toBeNull();
    focused = true;
  });
});
