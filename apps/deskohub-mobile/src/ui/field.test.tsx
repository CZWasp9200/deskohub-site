import { describe, expect, test } from "bun:test";
import { StyleSheet } from "react-native";
import {
  FieldLabel,
  FieldMessages,
  fieldDescription,
  fieldFrameState,
  fieldFrameStyles,
} from "./field";
import { idleLiveRegionLayout } from "./notice-presentation";
import {
  elementTree,
  findAll,
  flatStyle,
  hostTree,
} from "./testing/element-tree";
import { color } from "./tokens";

describe("fieldFrameState", () => {
  test("disabled, read-only, invalid, then focused win in that order", () => {
    expect(
      fieldFrameState({
        disabled: true,
        readOnly: true,
        invalid: true,
        focused: true,
      })
    ).toBe("disabled");
    expect(
      fieldFrameState({ readOnly: true, invalid: true, focused: true })
    ).toBe("readOnly");
    expect(fieldFrameState({ invalid: true, focused: true })).toBe("invalid");
    expect(fieldFrameState({ focused: true })).toBe("focused");
    expect(fieldFrameState({})).toBe("idle");
  });

  test("focus and error ring the frame 2 dp, keeping the content in place", () => {
    const frame = (state: keyof typeof fieldFrameStyles) =>
      StyleSheet.flatten(fieldFrameStyles[state]) as Record<string, unknown>;
    expect(frame("focused")).toMatchObject({
      borderColor: color.action,
      borderWidth: 2,
    });
    expect(frame("invalid")).toMatchObject({
      borderColor: color.danger,
      borderWidth: 2,
    });
    for (const state of ["idle", "focused", "invalid", "readOnly"] as const) {
      const { borderWidth, paddingHorizontal } = frame(state);
      expect(Number(borderWidth) + Number(paddingHorizontal)).toBe(15);
    }
  });
});

describe("fieldDescription", () => {
  const ids = { hintId: "h", errorId: "e" };
  test("an error describes the field over its hint", () => {
    expect(fieldDescription({ ...ids, hint: "hint", error: "error" })).toEqual({
      invalid: true,
      hint: "error",
      describedBy: "e",
    });
  });
  test("a hint describes a valid field", () => {
    expect(fieldDescription({ ...ids, hint: "hint", error: "" })).toEqual({
      invalid: false,
      hint: "hint",
      describedBy: "h",
    });
  });
  test("with neither the field is undescribed", () => {
    expect(
      fieldDescription({ ...ids, hint: undefined, error: undefined })
    ).toEqual({ invalid: false, hint: undefined, describedBy: undefined });
  });
});

describe("FieldMessages", () => {
  const messages = (hint?: string, error?: string) =>
    hostTree(
      elementTree(FieldMessages, { hint, hintId: "h", error, errorId: "e" })
    );
  const region = (tree: ReturnType<typeof messages>) =>
    findAll(tree, "Text").find((text) => text.props.role === "status");

  test("the error region stays mounted while idle, out of the layout", () => {
    const tree = messages("hint");
    expect(region(tree)?.props.children).toBe("");
    expect(
      StyleSheet.flatten(region(tree)?.props.style as never)
    ).toMatchObject(idleLiveRegionLayout);
    expect(findAll(tree, "Svg")).toHaveLength(0);
  });

  test("an error replaces the hint, with its icon", () => {
    const tree = messages("hint", "error");
    const texts = findAll(tree, "Text");
    expect(texts).toHaveLength(1);
    expect(region(tree)?.props.children).toBe("error");
    expect(region(tree)?.props["aria-live"]).toBe("polite");
    expect(findAll(tree, "Svg")).toHaveLength(1);
  });
});

describe("FieldLabel", () => {
  test("an optional field adds its marker inside the label, in a lighter style", () => {
    const tree = hostTree(
      elementTree(FieldLabel, { label: "VAT", optional: "(opt)" })
    );
    const texts = findAll(tree, "Text");
    expect(texts).toHaveLength(2);
    const [label, marker] = texts;
    // The marker is nested in the label, so both read as one.
    expect(findAll(label, "Text")).toHaveLength(2);
    expect(flatStyle(marker?.props.style).fontWeight).not.toBe(
      flatStyle(label?.props.style).fontWeight
    );
  });

  test("a required field's label is its text alone", () => {
    const tree = hostTree(elementTree(FieldLabel, { label: "City" }));
    expect(findAll(tree, "Text")).toHaveLength(1);
  });
});
