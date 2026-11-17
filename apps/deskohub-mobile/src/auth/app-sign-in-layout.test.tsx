import { describe, expect, test } from "bun:test";
import { StyleSheet, View } from "react-native";
import { AppSignInLayout } from "./app-sign-in-layout";
import { inOrder, shownTree } from "./testing/sign-in-step-tree";

const layout = (props: Partial<Parameters<typeof AppSignInLayout>[0]> = {}) =>
  inOrder(
    shownTree(AppSignInLayout, {
      title: "title",
      instructions: "instructions",
      onUseDifferentEmail: () => undefined,
      children: <View testID="field" />,
      action: <View testID="action" />,
      ...props,
    })
  );

const grows = (props: Readonly<Record<string, unknown>>) =>
  (
    StyleSheet.flatten(props.style as never) as
      | { flexGrow?: number }
      | undefined
  )?.flexGrow === 1;

describe("AppSignInLayout", () => {
  test("puts the heading, instructions and link on top, the field in the middle and the action at the bottom", () => {
    const elements = layout();
    const at = (match: (props: Record<string, unknown>) => boolean) =>
      elements.findIndex(({ props }) => match(props));
    const heading = at((props) => props.role === "heading");
    const instructions = at((props) => props.children === "instructions");
    const link = at((props) => props.role === "link");
    const field = at((props) => props.testID === "field");
    const action = at((props) => props.testID === "action");
    expect(heading).toBeGreaterThanOrEqual(0);
    expect([heading, instructions, link, field, action]).toEqual(
      [heading, instructions, link, field, action].slice().sort((a, b) => a - b)
    );
    expect(new Set([heading, instructions, link, field, action]).size).toBe(5);
    expect(action).toBe(elements.length - 1);
    // Free space opens above and below the field, so it sits in the middle
    // and the action at the bottom.
    const spacers = elements.flatMap((element, index) =>
      element.type === "View" && grows(element.props) ? [index] : []
    );
    expect(spacers).toHaveLength(2);
    expect(spacers[0]).toBeGreaterThan(link);
    expect(spacers[0]).toBeLessThan(field);
    expect(spacers[1]).toBeGreaterThan(field);
    expect(spacers[1]).toBeLessThan(action);
  });

  test("under the text, the field starts below the link and all free space is under it", () => {
    const elements = layout({ childrenPlacement: "under-text" });
    const field = elements.findIndex(({ props }) => props.testID === "field");
    const action = elements.findIndex(({ props }) => props.testID === "action");
    const spacers = elements.flatMap((element, index) =>
      element.type === "View" && grows(element.props) ? [index] : []
    );
    expect(spacers).toHaveLength(1);
    expect(spacers[0]).toBeGreaterThan(field);
    expect(spacers[0]).toBeLessThan(action);
  });

  test("the content scrolls when it doesn't fit", () => {
    expect(layout().some(({ type }) => type === "ScrollView")).toBe(true);
  });

  test("without a way to start over there is no different-email link", () => {
    const elements = layout({ onUseDifferentEmail: undefined });
    expect(elements.some(({ props }) => props.role === "link")).toBe(false);
  });

  test("the different-email link is disabled while a step runs", () => {
    const link = layout({ useDifferentEmailDisabled: true }).find(
      ({ props }) => props.role === "link"
    );
    expect(link?.props.disabled).toBe(true);
  });
});
