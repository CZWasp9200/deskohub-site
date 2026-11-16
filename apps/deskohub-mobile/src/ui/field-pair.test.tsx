import { afterAll, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import * as ReactNative from "react-native";
import { elementTree, flatStyle, type HostProps } from "./testing/element-tree";

let fontScale = 1;
mock.module("react-native", () => ({
  ...ReactNative,
  useWindowDimensions: () => ({ width: 360, height: 780, scale: 3, fontScale }),
}));
const { FieldPair } = await import("./field-pair");
// The mock outlives this file in the run; later files get the default scale.
afterAll(() => {
  fontScale = 1;
});

/** How the pair lays out its two fields at a text scale. */
const directionAt = (scale: number) => {
  fontScale = scale;
  const tree = elementTree(FieldPair, {
    wide: createElement("i"),
    narrow: createElement("b"),
  }) as ReactElement<HostProps>;
  return flatStyle(tree.props.style).flexDirection;
};

describe("FieldPair", () => {
  test("shares a line at normal text sizes and stacks at large ones", () => {
    expect(directionAt(1)).toBe("row");
    expect(directionAt(1.3)).toBe("column");
    expect(directionAt(2)).toBe("column");
  });
});
