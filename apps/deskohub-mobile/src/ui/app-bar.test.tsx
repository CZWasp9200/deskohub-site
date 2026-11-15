import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { Pressable } from "react-native";
import { AppLocaleProvider } from "../i18n/locale-context";
import { AppBar } from "./app-bar";
import { elementTree, find, flatStyle } from "./testing/element-tree";
import { Text } from "./text";
import { color, touchTarget } from "./tokens";

const bar = (props: Parameters<typeof AppBar>[0]) =>
  elementTree(AppBar, props, (component) => (
    <AppLocaleProvider locale="en-US">{component}</AppLocaleProvider>
  )) as ReactElement<{ style: unknown }>;

describe("AppBar", () => {
  test("is at least 64 tall on the paper canvas, its title a heading that wraps to two lines", () => {
    const tree = bar({ title: "title" });
    expect(flatStyle(tree.props.style)).toMatchObject({
      minHeight: 64,
      backgroundColor: color.paper,
    });
    const title = find(tree, Text)?.props;
    expect(title?.role).toBe("heading");
    expect(title?.variant).toBe("title");
    expect(title?.numberOfLines).toBe(2);
  });

  test("the back button is a named 48 dp round button that goes back", () => {
    const presses: string[] = [];
    const back = find(
      bar({ title: "title", onBack: () => presses.push("back") }),
      Pressable
    )?.props;
    if (!back) throw new Error("AppBar drew no back button");
    expect(back.role).toBe("button");
    expect(back["aria-label"]).toBeTruthy();
    const style = flatStyle(
      (back.style as (state: { pressed: boolean }) => unknown)({
        pressed: false,
      })
    );
    expect(style).toMatchObject({
      width: touchTarget,
      height: touchTarget,
      borderRadius: touchTarget / 2,
    });
    back.onPress?.({} as never);
    expect(presses).toEqual(["back"]);
  });

  test("without onBack there is no back button", () => {
    expect(find(bar({ title: "title" }), Pressable)).toBeUndefined();
  });

  test("actions follow the title", () => {
    const action = createElement("Action");
    expect(
      find(bar({ title: "title", actions: action }), "Action")
    ).toBeDefined();
  });

  test("raised draws the hairline in the line colour; otherwise it stays transparent", () => {
    const edge = (raised: boolean) =>
      flatStyle(bar({ title: "title", raised }).props.style)?.borderBottomColor;
    expect(edge(true)).toBe(color.line);
    expect(edge(false)).toBe("transparent");
  });
});
