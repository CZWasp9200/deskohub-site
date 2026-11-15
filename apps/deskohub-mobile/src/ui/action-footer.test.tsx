import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { ActionFooter } from "./action-footer";
import { Button } from "./controls";
import { idleLiveRegionLayout } from "./notice-presentation";
import { elementTree, find, findAll, hostTree } from "./testing/element-tree";
import { color } from "./tokens";

const flat = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

const footer = (props: Partial<ComponentProps<typeof ActionFooter>> = {}) => {
  const tree = elementTree(ActionFooter, {
    children: <Button label="b" onPress={() => undefined} />,
    ...props,
  });
  const host = hostTree(tree);
  return {
    tree,
    footer: flat(find(host, "View")?.props.style),
    region: findAll(host, "Text").find((text) => text.props.role === "status")
      ?.props,
  };
};

describe("ActionFooter", () => {
  test("is white with a hairline above, holding its buttons", () => {
    const { tree, footer: style } = footer();
    expect(style).toMatchObject({
      backgroundColor: color.surface,
      borderTopColor: color.line,
      borderTopWidth: 1,
    });
    expect(find(tree, Button)).toBeDefined();
  });

  test("its message region stays mounted, idle out of the layout", () => {
    const { region } = footer();
    expect(region?.children).toBe("");
    expect(region?.["aria-live"]).toBe("polite");
    expect(flat(region?.style)).toMatchObject(idleLiveRegionLayout);
  });

  test("a neutral message is centred and muted", () => {
    const { region } = footer({ message: "m" });
    expect(region?.children).toBe("m");
    expect(flat(region?.style)).toMatchObject({
      textAlign: "center",
      color: color.ink2,
    });
  });

  test("an error message is crimson", () => {
    const { region } = footer({ message: "m", messageTone: "error" });
    expect(flat(region?.style).color).toBe(color.dangerInk);
    expect(region?.role).toBe("status");
  });
});
