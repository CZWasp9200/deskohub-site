import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { Card } from "./card";
import { elementTree, type HostProps } from "./testing/element-tree";
import { space } from "./tokens";

const cardStyle = (padding?: "regular" | "none") =>
  StyleSheet.flatten(
    (elementTree(Card, { children: "c", padding }) as ReactElement<HostProps>)
      .props.style as never
  ) as Record<string, unknown>;

test("pads its content unless the content brings its own insets", () => {
  expect(cardStyle().padding).toBe(space.xl);
  expect(cardStyle("regular").padding).toBe(space.xl);
  expect(cardStyle("none").padding).toBeUndefined();
});
