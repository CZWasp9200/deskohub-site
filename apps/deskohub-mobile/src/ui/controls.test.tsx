import { describe, expect, mock, test } from "bun:test";
import Mail from "lucide-react-native/icons/mail";
import { type ComponentProps, createRef } from "react";
import { StyleSheet, type TextInputInstance } from "react-native";
import { theme } from "../theme";
import { Button, ButtonRow, TextField } from "./controls";
import { LoadingIndicator } from "./loading-indicator";
import { idleLiveRegionLayout } from "./notice-presentation";
import {
  elementTree,
  find,
  findAll,
  hostTree,
  textOf,
} from "./testing/element-tree";
import { color } from "./tokens";

const button = (props: Partial<ComponentProps<typeof Button>> = {}) =>
  hostTree(
    elementTree(Button, { label: "label", onPress: () => undefined, ...props })
  );

const pressableOf = (tree: ReturnType<typeof button>) => {
  const pressable = find(tree, "Pressable");
  if (!pressable) throw new Error("The button has no pressable.");
  return pressable.props;
};

/** The pressable's style when not pressed. */
const restingStyle = (tree: ReturnType<typeof button>) =>
  StyleSheet.flatten(
    (pressableOf(tree).style as (state: { pressed: boolean }) => unknown)({
      pressed: false,
    }) as never
  ) as Record<string, unknown>;

describe("Button", () => {
  test("an accessible label names the pressable", () => {
    expect(
      pressableOf(button({ accessibilityLabel: "named" }))["aria-label"]
    ).toBe("named");
  });

  test("without one, the pressable is named by its visible label", () => {
    const tree = button();
    expect(pressableOf(tree)["aria-label"]).toBeUndefined();
    expect(pressableOf(tree).role).toBe("button");
    expect(findAll(tree, "Text").map(textOf)).toContain("label");
  });

  test("each variant has its own fill", () => {
    const fills = (
      [
        "primary",
        "secondary",
        "danger",
        "text",
        "quiet",
        "dangerText",
        "inverse",
      ] as const
    ).map((variant) => restingStyle(button({ variant })).backgroundColor);
    expect(fills).toEqual([
      color.action,
      color.surface,
      color.danger,
      "transparent",
      "transparent",
      "transparent",
      color.surface,
    ]);
  });

  test("busy shows the loading indicator in place of the icon, keeps the label and ignores presses", () => {
    const onPress = mock(() => undefined);
    const tree = button({ busy: true, icon: Mail, onPress });
    const pressable = pressableOf(tree);
    expect(pressable["aria-busy"]).toBe(true);
    expect(pressable.onPress).toBeUndefined();
    expect(
      find(
        elementTree(Button, {
          label: "label",
          onPress,
          busy: true,
          icon: Mail,
        }),
        LoadingIndicator
      )
    ).toBeDefined();
    expect(find(tree, "Svg")).toBeUndefined();
    expect(findAll(tree, "Text").map(textOf)).toContain("label");
  });

  test("an icon is drawn before the label", () => {
    expect(find(button({ icon: Mail }), "Svg")).toBeDefined();
  });

  test("disabled is neutral grey and says why, above the button and as its hint", () => {
    const tree = button({ disabled: true, disabledReason: "why" });
    const pressable = pressableOf(tree);
    expect(pressable["aria-disabled"]).toBe(true);
    expect(pressable.accessibilityHint).toBe("why");
    const reason = findAll(tree, "Text").find((text) => textOf(text) === "why");
    expect(reason?.props.id).toBeString();
    expect(pressable["aria-describedby"]).toBe(reason?.props.id);
    expect(restingStyle(tree).backgroundColor).toBe(color.disabled);
  });

  test("an enabled button keeps its reason's place empty and undescribed", () => {
    const pressable = pressableOf(button({ disabledReason: "why" }));
    expect(pressable.accessibilityHint).toBeUndefined();
    expect(pressable["aria-describedby"]).toBeUndefined();
  });
});

describe("ButtonRow", () => {
  test("shares the row between its buttons and lets them wrap", () => {
    const row = elementTree(ButtonRow, {
      children: [
        <Button key="a" label="a" onPress={() => undefined} />,
        <Button key="b" label="b" onPress={() => undefined} />,
      ],
    });
    expect(
      StyleSheet.flatten(find(row, "View")?.props.style as never)
    ).toMatchObject({
      flexDirection: "row",
      flexWrap: "wrap",
    });
    expect(findAll(row, Button)).toHaveLength(2);
  });
});

/** The input and the error live region (its only Text with a role). */
const field = (props: Partial<ComponentProps<typeof TextField>> = {}) => {
  const tree = hostTree(elementTree(TextField, { label: "label", ...props }));
  return {
    input: find(tree, "TextInput")?.props,
    errorRegion: findAll(tree, "Text").find(
      (text) => text.props.role !== undefined
    )?.props,
  };
};

const styleEntries = (style: unknown) =>
  [style].flat().filter((entry) => typeof entry === "object" && !!entry);

describe("TextField", () => {
  test("without an error the field is valid and its live region idles out of the layout", () => {
    for (const error of [undefined, ""]) {
      const { input, errorRegion } = field({ error });
      expect(input?.["aria-invalid"]).toBe(false);
      expect(input?.accessibilityHint).toBeUndefined();
      expect(input?.["aria-describedby"]).toBeUndefined();
      expect(errorRegion).toBeDefined();
      expect(errorRegion?.style).toBe(idleLiveRegionLayout);
      expect(errorRegion?.children).toBe("");
    }
  });

  test("an error marks the input invalid and describes it", () => {
    const error = "x";
    const { input, errorRegion } = field({ error });
    expect(input?.["aria-invalid"]).toBe(true);
    expect(input?.accessibilityHint).toBe(error);
    expect(errorRegion?.id).toBeString();
    expect(input?.["aria-describedby"]).toBe(errorRegion?.id);
    expect(styleEntries(input?.style)).toContainEqual({
      borderColor: theme.colors.danger,
    });
    expect(errorRegion?.children).toBe(error);
    expect(errorRegion?.style).not.toBe(idleLiveRegionLayout);
  });

  test("the error region declares a polite live region, idle or shown", () => {
    for (const error of [undefined, "x"]) {
      const { errorRegion } = field({ error });
      expect(errorRegion?.role).toBe("status");
      expect(errorRegion?.["aria-live"]).toBe("polite");
      expect(errorRegion?.accessibilityLiveRegion).toBe("polite");
    }
  });

  test("the ref reaches the input, so a form can focus it", () => {
    const ref = createRef<TextInputInstance>();
    expect(field({ ref }).input?.ref).toBe(ref);
  });

  test("autoCapitalize stays off unless a caller sets it", () => {
    expect(field().input?.autoCapitalize).toBe("none");
    expect(field({ autoCapitalize: "words" }).input?.autoCapitalize).toBe(
      "words"
    );
  });
});
