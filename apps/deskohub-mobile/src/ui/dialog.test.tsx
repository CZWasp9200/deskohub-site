import { describe, expect, test } from "bun:test";
import {
  Children,
  createElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { Dialog } from "./dialog";
import { elementTree, find, findAll, flatStyle } from "./testing/element-tree";
import { Text } from "./text";
import { color, radius, space } from "./tokens";

const dismiss = () => undefined;

const dialog = (props: Partial<Parameters<typeof Dialog>[0]> = {}) =>
  elementTree(
    Dialog,
    {
      visible: true,
      title: "title",
      body: "body",
      onDismiss: dismiss,
      actions: createElement("Actions"),
      ...props,
    },
    (component) =>
      createElement(
        SafeAreaInsetsContext.Provider,
        { value: { top: 30, right: 0, bottom: 20, left: 0 } },
        component
      )
  );

/** The card: the element carrying the dialog role. */
const card = (tree: ReturnType<typeof dialog>) =>
  findAll(tree, "View").find((view) => view.props.role !== undefined);

describe("Dialog", () => {
  test("a transparent modal that the back button dismisses", () => {
    const modal = find(dialog({ visible: false }), "Modal")?.props;
    expect(modal?.visible).toBe(false);
    expect(modal?.transparent).toBe(true);
    expect(modal?.onRequestClose).toBe(dismiss);
  });

  test("the navy scrim keeps the safe areas clear and dismisses on a tap", () => {
    const tree = dialog();
    const scrim = find(tree, "View");
    expect(flatStyle(scrim?.props.style)).toMatchObject({
      backgroundColor: color.scrim,
      paddingHorizontal: space.xxl,
      paddingTop: 30 + space.xxl,
      paddingBottom: 20 + space.xxl,
    });
    expect(find(tree, "Pressable")?.props.onPress).toBe(dismiss);
  });

  test("a white, rounded, modal dialog named by its title", () => {
    const props = card(dialog())?.props;
    expect(props?.role).toBe("dialog");
    expect(props?.["aria-modal"]).toBe(true);
    expect(props?.["aria-label"]).toBe("title");
    expect(flatStyle(props?.style)).toMatchObject({
      backgroundColor: color.surface,
      borderRadius: radius.overlay,
      padding: space.xxl,
    });
    expect(
      card(dialog({ role: "alertdialog", busy: true }))?.props
    ).toMatchObject({ role: "alertdialog", "aria-busy": true });
  });

  test("the title, body and content scroll; the actions stay below them", () => {
    const tree = dialog({ children: createElement("Content") });
    const scroll = find(tree, "ScrollView");
    const copy = Children.toArray(scroll?.props.children) as ReactElement<{
      role?: string;
      variant?: string;
    }>[];
    expect(copy.map((child) => child.type)).toEqual([Text, Text, "Content"]);
    expect(copy[0]?.props).toMatchObject({
      role: "heading",
      variant: "dialogTitle",
    });
    expect(copy[1]?.props).toMatchObject({ variant: "lead", tone: "muted" });
    const cardChildren = Children.toArray(card(tree)?.props.children);
    expect(find(cardChildren[1] as ReactElement, "Actions")).toBeDefined();
  });

  test("without a body only the title leads", () => {
    const scroll = find(dialog({ body: undefined }), "ScrollView");
    expect(Children.toArray(scroll?.props.children)).toHaveLength(1);
  });
  test("a header leads above the title, and an icon shares the title's line", () => {
    const scroll = find(
      dialog({
        header: createElement("Header"),
        titleIcon: () => null,
        body: undefined,
      }),
      "ScrollView"
    );
    const [header, titleLine] = Children.toArray(
      scroll?.props.children
    ) as ReactElement<{ children?: ReactNode }>[];
    expect(header?.type).toBe("Header");
    const line = Children.toArray(titleLine?.props.children) as ReactElement[];
    expect(line).toHaveLength(2);
    expect(line[1]?.type).toBe(Text);
  });
});
