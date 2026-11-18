import { expect, test } from "bun:test";
import Check from "lucide-react-native/icons/check";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { Badge, type BadgeTone } from "./badge";
import { Icon } from "./icon";
import {
  elementTree,
  find,
  findAll,
  type HostProps,
} from "./testing/element-tree";
import { Text } from "./text";

const tones: ReadonlyArray<BadgeTone> = [
  "positive",
  "neutral",
  "warning",
  "danger",
  "info",
];

const badge = (tone: BadgeTone, withIcon = false) => {
  const tree = elementTree(Badge, {
    label: "l",
    tone,
    icon: withIcon ? Check : undefined,
  }) as ReactElement<HostProps>;
  const flat = (style: unknown) =>
    StyleSheet.flatten(style as never) as Record<string, unknown>;
  return {
    tree,
    background: flat(tree.props.style).backgroundColor,
    ink: flat(find(tree, Text)?.props.style).color,
    iconColor: find<Parameters<typeof Icon>[0]>(tree, Icon)?.props.color,
  };
};

test("is static text, never a control", () => {
  const { tree } = badge("positive", true);
  expect(tree.props.role).toBeUndefined();
  expect(find(tree, "Pressable")).toBeUndefined();
  expect(findAll(tree, Text)).toHaveLength(1);
});

test("each tone has its own tint, and the icon takes the text colour", () => {
  const backgrounds = new Set(tones.map((tone) => badge(tone).background));
  expect(backgrounds.size).toBe(tones.length);
  for (const tone of tones) {
    const { ink, iconColor } = badge(tone, true);
    expect(iconColor).toBe(ink as string);
  }
  expect(find(badge("info").tree, Icon)).toBeUndefined();
});

test("a stacked badge sets one word per line and still reads its label whole", () => {
  const tree = elementTree(Badge, {
    label: "Withdrawal  received",
    tone: "neutral",
    stacked: true,
  }) as ReactElement<HostProps>;
  const text = find<HostProps>(tree, Text);
  expect(text?.props["aria-label"]).toBe("Withdrawal  received");
  expect(text?.props.children).toBe("Withdrawal\nreceived");
});

test("a badge on one line has no separate accessible label", () => {
  const tree = elementTree(Badge, {
    label: "Confirmed",
    tone: "positive",
  }) as ReactElement<HostProps>;
  const text = find<HostProps>(tree, Text);
  expect(text?.props["aria-label"]).toBeUndefined();
  expect(text?.props.children).toBe("Confirmed");
});
