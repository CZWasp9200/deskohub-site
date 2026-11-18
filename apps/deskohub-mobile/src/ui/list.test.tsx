import { describe, expect, test } from "bun:test";
import Check from "lucide-react-native/icons/check";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ExternalLink from "lucide-react-native/icons/external-link";
import Mail from "lucide-react-native/icons/mail";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { Badge } from "./badge";
import { CheckboxRow } from "./checkbox";
import { Icon } from "./icon";
import { ListGroup, ListRow, SectionHeader } from "./list";
import { listDividerInset } from "./list-row-layout";
import { SwitchRow } from "./switch";
import {
  elementTree,
  find,
  findAll,
  type HostProps,
} from "./testing/element-tree";
import { Text } from "./text";
import { color } from "./tokens";

const ignore = () => undefined;
const style = (props: HostProps | undefined) =>
  (StyleSheet.flatten(props?.style as never) ?? {}) as Record<string, unknown>;
// A Pressable's style is a function of its pressed state.
const pressableStyle = (props: HostProps, pressed = false) =>
  style({
    style: (props.style as (state: { pressed: boolean }) => unknown)({
      pressed,
    }),
  });

/** The row's root: a Pressable when it can be pressed, else a View. */
const rowRoot = (props: Parameters<typeof ListRow>[0]) =>
  elementTree(ListRow, props) as ReactElement<HostProps>;

const trailingIcons = (props: Parameters<typeof ListRow>[0]) =>
  findAll<Parameters<typeof Icon>[0]>(elementTree(ListRow, props), Icon).map(
    (icon) => icon.props.icon
  );

describe("SectionHeader", () => {
  test("is a level 2 heading with an optional description", () => {
    const plain = elementTree(SectionHeader, { title: "t" });
    const heading = find<HostProps>(plain, Text as never)?.props;
    expect(heading?.role).toBe("heading");
    expect(heading?.["aria-level"]).toBe(2);
    expect(findAll(plain, Text)).toHaveLength(1);
    expect(
      findAll(
        elementTree(SectionHeader, { title: "t", description: "d" }),
        Text
      )
    ).toHaveLength(2);
  });

  test("sits closer to the top when it comes first", () => {
    const top = (first: boolean) =>
      style(
        (
          elementTree(SectionHeader, {
            title: "t",
            first,
          }) as ReactElement<HostProps>
        ).props
      ).paddingTop as number;
    expect(top(true)).toBeLessThan(top(false));
  });
});

describe("ListGroup", () => {
  const dividers = (tree: ReturnType<typeof elementTree>) =>
    findAll(tree, "View").filter((view) => view.props["aria-hidden"]);

  test("draws a hidden divider between rows and drops absent rows", () => {
    const tree = elementTree(ListGroup, {
      children: [
        <ListRow key="a" label="a" />,
        false,
        <ListRow key="b" label="b" />,
        <ListRow key="c" label="c" />,
      ],
    });
    expect(dividers(tree)).toHaveLength(2);
    expect(findAll(tree, ListRow)).toHaveLength(3);
  });

  test("starts a divider under the text, past the icon tile when a row has one", () => {
    const insets = (icons: ReadonlyArray<boolean>) =>
      dividers(
        elementTree(ListGroup, {
          children: icons.map((icon, index) => (
            <ListRow
              key={String(index)}
              label="r"
              icon={icon ? Mail : undefined}
            />
          )),
        })
      ).map((divider) => style(divider.props).marginStart);
    const withIcon = listDividerInset({ above: true, below: true });
    const plain = listDividerInset({ above: false, below: false });
    expect(withIcon).toBeGreaterThan(plain);
    expect(insets([true, true])).toEqual([withIcon]);
    expect(insets([false, false])).toEqual([plain]);
    expect(insets([true, false, false])).toEqual([withIcon, plain]);
  });

  test("divides rows of any component that follows the row layout", () => {
    const OtherRow = (_: { readonly icon?: typeof Mail }) => null;
    const tree = elementTree(ListGroup, {
      children: [
        <OtherRow key="a" icon={Mail} />,
        <ListRow key="b" label="b" />,
      ],
    });
    expect(dividers(tree).map((d) => style(d.props).marginStart)).toEqual([
      listDividerInset({ above: true, below: false }),
    ]);
  });

  test("divides list, switch and checkbox rows by their icons: 70 next to an icon, 16 otherwise", () => {
    const tree = elementTree(ListGroup, {
      children: [
        <ListRow key="list" label="l" icon={Mail} />,
        <SwitchRow
          key="switch"
          label="s"
          icon={Mail}
          value={false}
          onValueChange={ignore}
        />,
        <CheckboxRow
          key="checkbox"
          label="c"
          checked={false}
          onChange={ignore}
        />,
        <SwitchRow
          key="plain-switch"
          label="p"
          value={false}
          onValueChange={ignore}
        />,
        <ListRow key="plain-list" label="q" />,
      ],
    });
    expect(dividers(tree).map((d) => style(d.props).marginStart)).toEqual([
      70, 70, 16, 16,
    ]);
  });
});

describe("ListRow", () => {
  test("a row without a press handler is content read as one label", () => {
    const root = rowRoot({ label: "l", value: "v", description: "d" });
    expect(root.type).toBe("View");
    expect(root.props.accessible).toBe(true);
    expect(root.props["aria-label"]).toBe("l, v, d");
    expect(root.props.role).toBeUndefined();
  });

  test("a badge sits beside the label and is read with the row", () => {
    const badge = <Badge label="b" tone="positive" />;
    const root = rowRoot({ label: "l", description: "d", badge });
    expect(root.props.accessible).toBe(true);
    expect(root.props["aria-label"]).toBeUndefined();
    expect(JSON.stringify(root)).toContain('"b"');
  });

  test("content below the text keeps its own elements", () => {
    const below = <Text>below</Text>;
    const root = rowRoot({ label: "l", description: "d", below });
    expect(root.type).toBe("View");
    expect(root.props.accessible).toBeUndefined();
    expect(root.props["aria-label"]).toBeUndefined();
    expect(JSON.stringify(root)).toContain("below");
  });

  test("a navigation row is a link ending in a chevron", () => {
    const root = rowRoot({ label: "l", onPress: ignore });
    expect(root.type).toBe("Pressable");
    expect(root.props.role).toBe("link");
    expect(trailingIcons({ label: "l", onPress: ignore })).toEqual([
      ChevronRight,
    ]);
  });

  test("an action row is a button without a chevron", () => {
    expect(
      rowRoot({ label: "l", onPress: ignore, kind: "action" }).props.role
    ).toBe("button");
    expect(
      trailingIcons({ label: "l", onPress: ignore, kind: "action" })
    ).toEqual([]);
  });

  test("trailing picks the external icon, nothing, or the caller's node", () => {
    expect(
      trailingIcons({ label: "l", onPress: ignore, trailing: "external" })
    ).toEqual([ExternalLink]);
    expect(
      trailingIcons({ label: "l", onPress: ignore, trailing: "none" })
    ).toEqual([]);
    const badge = <Badge label="b" tone="positive" />;
    const tree = elementTree(ListRow, { label: "l", trailing: badge });
    expect(find(tree, Badge)).toBeDefined();
    // The badge's own text is read with the row, not replaced by a label.
    expect(
      (tree as ReactElement<HostProps>).props["aria-label"]
    ).toBeUndefined();
  });

  test("an icon sits on a tile toned by the row", () => {
    const tile = (props: Parameters<typeof ListRow>[0]) => {
      const tree = elementTree(ListRow, props);
      const icon = find<Parameters<typeof Icon>[0]>(tree, Icon);
      const view = findAll(tree, "View").find(
        (v) => findAll(v, Icon).length > 0 && style(v.props).width === 40
      );
      return {
        background: style(view?.props).backgroundColor,
        ink: icon?.props.color,
      };
    };
    expect(tile({ label: "l", icon: Mail })).toEqual({
      background: color.sunken,
      ink: color.navy,
    });
    expect(tile({ label: "l", icon: Mail, destructive: true })).toEqual({
      background: color.dangerTint,
      ink: color.dangerInk,
    });
    expect(tile({ label: "l", icon: Mail, iconTone: "positive" })).toEqual({
      background: color.positiveTint,
      ink: color.positiveInk,
    });
    expect(findAll(elementTree(ListRow, { label: "l" }), Icon)).toEqual([]);
  });

  test("is 56 tall at least, 72 with a description", () => {
    const height = (description?: string) =>
      style(rowRoot({ label: "l", description }).props).minHeight;
    expect(height()).toBe(56);
    expect(height("d")).toBe(72);
  });

  test("tints while pressed, unless disabled", () => {
    const enabled = rowRoot({ label: "l", onPress: ignore }).props;
    expect(pressableStyle(enabled, true).backgroundColor).toBe(color.pressed);
    expect(pressableStyle(enabled, false).backgroundColor).toBeUndefined();
    const disabled = rowRoot({
      label: "l",
      onPress: ignore,
      disabled: true,
    }).props;
    expect(disabled.disabled).toBe(true);
    expect(disabled["aria-disabled"]).toBe(true);
    expect(pressableStyle(disabled, true).backgroundColor).toBeUndefined();
  });

  test("a destructive row's label is in the danger tone", () => {
    const label = (destructive: boolean) =>
      find(elementTree(ListRow, { label: "l", destructive }), Text)?.props.tone;
    expect(label(true)).toBe("danger");
    expect(label(false)).toBe("default");
  });

  test("a value moves under the label unless wrapValue keeps it beside", () => {
    const body = (wrapValue: boolean) =>
      findAll(
        elementTree(ListRow, { label: "l", value: "v", wrapValue }),
        "View"
      )
        .map((view) => style(view.props))
        .find((s) => s.flexWrap !== undefined)?.flexWrap;
    expect(body(false)).toBe("wrap");
    expect(body(true)).toBe("nowrap");
  });

  test("a pick-list row says whether it is chosen, and the chosen one ends in the action check", () => {
    const pick = {
      label: "l",
      kind: "action" as const,
      onPress: () => undefined,
    };
    const chosen = rowRoot({ ...pick, selected: true });
    expect(chosen.props["aria-selected"]).toBe(true);
    // Its name stays the row's text: the check is drawn, not read.
    expect(chosen.props["aria-label"]).toBe("l");
    const check = find<Parameters<typeof Icon>[0]>(
      elementTree(ListRow, { ...pick, selected: true }),
      Icon
    )?.props;
    expect(check?.icon).toBe(Check);
    expect(check?.color).toBe(color.action);
    const other = rowRoot({ ...pick, selected: false });
    expect(other.props["aria-selected"]).toBe(false);
    expect(trailingIcons({ ...pick, selected: false })).toEqual([]);
    expect(rowRoot(pick).props["aria-selected"]).toBeUndefined();
  });

  test("an active navigation row marks the current page and exposes native selection", () => {
    const row = {
      label: "l",
      trailing: "none" as const,
      onPress: () => undefined,
    };
    const current = rowRoot({ ...row, active: true });
    expect(current.props["aria-current"]).toBe("page");
    expect(current.props["aria-selected"]).toBe(true);
    expect(trailingIcons({ ...row, active: true })).toEqual([]);
    expect(rowRoot(row).props["aria-selected"]).toBeUndefined();
  });
});
