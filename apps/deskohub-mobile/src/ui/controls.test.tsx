import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import Mail from "lucide-react-native/icons/mail";
import {
  type ComponentProps,
  createRef,
  type ReactElement,
  type RefObject,
} from "react";
import { StyleSheet, type TextInputInstance } from "react-native";
import { Button, ButtonRow, TextField } from "./controls";
import { type FieldView, FocusedFieldContext } from "./focused-field-scroll";
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
        "positive",
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
      color.positiveInk,
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

  test("going busy keeps the button's size and the label's width", () => {
    // The pressable's direct children are what the row lays out.
    const laidOut = (props: Partial<ComponentProps<typeof Button>>) => {
      const tree = button(props);
      const children = [find(tree, "Pressable")?.props.children]
        .flat(2)
        .filter(Boolean) as ReactElement<{ style?: unknown }>[];
      const style = restingStyle(tree);
      return {
        slots: children.map((child) =>
          StyleSheet.flatten(child.props.style as never)
        ),
        // Side padding plus the gap and the slot beside the label.
        besideLabel:
          2 * Number(style.paddingHorizontal) +
          (children.length - 1) * (20 + Number(style.gap)),
      };
    };
    // With an icon the die takes the icon's slot.
    expect(laidOut({ busy: true, icon: Mail })).toEqual(
      laidOut({ icon: Mail })
    );
    // Without one, its slot comes out of the side padding.
    for (const size of ["regular", "small"] as const) {
      for (const variant of ["primary", "text"] as const) {
        const idle = laidOut({ size, variant });
        const busy = laidOut({ size, variant, busy: true });
        expect(busy.slots).toHaveLength(idle.slots.length + 1);
        expect(busy.besideLabel).toBe(idle.besideLabel);
      }
    }
  });

  test("an icon is drawn before the label", () => {
    expect(find(button({ icon: Mail }), "Svg")).toBeDefined();
  });

  test("iconPlacement end draws the icon after the label", () => {
    const iconFirst = (placement: "start" | "end") => {
      const json = JSON.stringify(
        button({ icon: Mail, iconPlacement: placement })
      );
      return json.indexOf('"Svg"') < json.indexOf('"label"');
    };
    expect(iconFirst("start")).toBe(true);
    expect(iconFirst("end")).toBe(false);
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

  test("the reason sits above the button by default and below it on request", () => {
    const order = (placement?: "above" | "below") => {
      const wrapper = elementTree(Button, {
        label: "label",
        onPress: () => undefined,
        disabled: true,
        disabledReason: "why",
        reasonPlacement: placement,
      }) as { readonly props: { readonly children: unknown[] } };
      return wrapper.props.children
        .filter(Boolean)
        .map((child) =>
          (child as { readonly type: unknown }).type === "Pressable"
            ? "button"
            : "reason"
        );
    };
    expect(order()).toEqual(["reason", "button"]);
    expect(order("below")).toEqual(["button", "reason"]);
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

  test("each button's share grows with the font size, so large text stacks them", () => {
    // The test window is 360 wide at the default font size.
    const row = elementTree(ButtonRow, {
      children: [<Button key="a" label="a" onPress={() => undefined} />],
    });
    const item = findAll(row, "View")[1];
    expect(StyleSheet.flatten(item?.props.style as never)).toMatchObject({
      flexBasis: 136,
      flexGrow: 1,
    });
  });
});

const flat = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

/**
 * The input, its frame (the view around it), the hint, the error live
 * region (the only Text with a role) and the icons drawn in the field.
 */
const field = (props: Partial<ComponentProps<typeof TextField>> = {}) => {
  const tree = hostTree(elementTree(TextField, { label: "label", ...props }));
  const frame = findAll(tree, "View").find(
    (view) => flat(view.props.style).minHeight !== undefined
  );
  const errorRegion = findAll(tree, "Text").find(
    (text) => text.props.role !== undefined
  )?.props;
  return {
    input: find(tree, "TextInput")?.props,
    frame: flat(frame?.props.style),
    icons: frame ? findAll(frame, "Svg").length : 0,
    errorRegion,
    hint: findAll(tree, "Text").find(
      (text) => text.props.id !== undefined && text.props !== errorRegion
    )?.props,
  };
};

describe("TextField", () => {
  test("focus and blur report the whole field, label to messages, to its scroll view", () => {
    const reports: Array<[string, FieldView]> = [];
    const tracker = {
      focused: (view: FieldView) => reports.push(["focused", view]),
      blurred: (view: FieldView) => reports.push(["blurred", view]),
    };
    const column = elementTree(
      TextField,
      { label: "Phone", hint: "Include the country code." },
      (node) => (
        <FocusedFieldContext value={tracker}>{node}</FocusedFieldContext>
      )
    ) as ReactElement<{ ref: RefObject<FieldView | null> }>;
    const mounted: FieldView = {
      measureInWindow: () => undefined,
      measureLayout: () => undefined,
    };
    column.props.ref.current = mounted;
    const input = find(hostTree(column), "TextInput")?.props as {
      onFocus: () => void;
      onBlur: (event: unknown) => void;
    };

    input.onFocus();
    input.onBlur({});
    expect(reports).toEqual([
      ["focused", mounted],
      ["blurred", mounted],
    ]);
  });

  test("the web input draws no outline of its own, so only the frame rings on focus", () => {
    // Chromium draws an `auto` outline whatever its width.
    expect(flat(field().input?.style)).toMatchObject({
      outlineStyle: "none",
      outlineWidth: 0,
    });
  });

  test("without an error the field is valid and its live region idles out of the layout", () => {
    for (const error of [undefined, ""]) {
      const { input, errorRegion } = field({ error });
      expect(input?.["aria-invalid"]).toBe(false);
      expect(input?.accessibilityHint).toBeUndefined();
      expect(input?.["aria-describedby"]).toBeUndefined();
      expect(errorRegion).toBeDefined();
      expect(flat(errorRegion?.style)).toMatchObject(idleLiveRegionLayout);
      expect(errorRegion?.children).toBe("");
    }
  });

  test("an error marks the input invalid, rings the frame crimson and describes it", () => {
    const error = "x";
    const { input, frame, errorRegion } = field({ error });
    expect(input?.["aria-invalid"]).toBe(true);
    expect(input?.accessibilityHint).toBe(error);
    expect(errorRegion?.id).toBeString();
    expect(input?.["aria-describedby"]).toBe(errorRegion?.id);
    expect(frame).toMatchObject({ borderColor: color.danger, borderWidth: 2 });
    expect(errorRegion?.children).toBe(error);
    expect(flat(errorRegion?.style).position).toBeUndefined();
  });

  test("the error replaces the hint and the hint describes a valid field", () => {
    const valid = field({ hint: "h" });
    expect(valid.hint?.children).toBe("h");
    expect(valid.input?.accessibilityHint).toBe("h");
    expect(valid.input?.["aria-describedby"]).toBe(valid.hint?.id);
    const invalid = field({ hint: "h", error: "x" });
    expect(invalid.hint).toBeUndefined();
    expect(invalid.input?.accessibilityHint).toBe("x");
  });

  test("the frame is a 52 dp field-outlined box with radius 14", () => {
    expect(field().frame).toMatchObject({
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: color.field,
      backgroundColor: color.surface,
    });
    expect(field().input?.placeholderTextColor).toBe(color.ink3);
  });

  test("read-only is sunken with a lock and shows its whole value, wrapping", () => {
    const value = testEmailAddress("a-very-long-address-that-must-wrap");
    const tree = hostTree(
      elementTree(TextField, { label: "label", value, readOnly: true })
    );
    const { input, frame, icons } = field({ value, readOnly: true });
    expect(frame.backgroundColor).toBe(color.sunken);
    expect(icons).toBe(1);
    expect(input).toBeUndefined();
    const shown = findAll(tree, "Text").find(
      (text) => text.props.children === value
    );
    expect(shown?.props.numberOfLines).toBeUndefined();
    expect(shown?.props.selectable).toBe(true);
  });

  test("disabled is greyed, not editable and marked disabled", () => {
    const { input, frame } = field({ disabled: true });
    expect(frame.backgroundColor).toBe(color.disabledField);
    expect(input?.editable).toBe(false);
    expect(input?.["aria-disabled"]).toBe(true);
    expect(flat(input?.style).color).toBe(color.disabledInk);
  });

  test("leading and trailing icons sit inside the frame", () => {
    expect(field({ leadingIcon: Mail, trailingIcon: Mail }).icons).toBe(2);
    expect(field().icons).toBe(0);
  });

  test("an error shows its icon beside the message", () => {
    const tree = hostTree(
      elementTree(TextField, { label: "label", error: "x" })
    );
    expect(findAll(tree, "Svg")).toHaveLength(1);
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
