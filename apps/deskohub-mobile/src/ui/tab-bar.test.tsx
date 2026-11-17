import { describe, expect, mock, test } from "bun:test";
import CalendarCheck from "lucide-react-native/icons/calendar-check";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CircleUser from "lucide-react-native/icons/circle-user";
import { createContext, type ReactElement, type ReactNode } from "react";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

// The bar registers its height with the toasts while the tabs have focus;
// outside a navigator the focus effect does nothing.
mock.module("expo-router", () =>
  expoRouterStandIn({ useFocusEffect: () => undefined })
);
// Bun can't load expo-router's bundled React Navigation.
mock.module("expo-router/tabs", () => ({
  BottomTabBarHeightCallbackContext: createContext<
    ((height: number) => void) | undefined
  >(undefined),
}));

const { TabBar, tabBarHeight, tabBarObstruction } = await import("./tab-bar");
const { Icon } = await import("./icon");
const { elementTree, find, findAll, flatStyle } = await import(
  "./testing/element-tree"
);
const { color } = await import("./tokens");
const { ToastProvider } = await import("./toast");

type TabBarProps = Parameters<typeof TabBar>[0];

const routes = [
  { key: "account-key", name: "account" },
  { key: "book-key", name: "book" },
  { key: "reservations-key", name: "reservations" },
];
const items = {
  account: { icon: CircleUser },
  book: { icon: CalendarPlus, raised: true },
  reservations: { icon: CalendarCheck },
};

const render = ({
  items: shown = items as TabBarProps["items"],
  index = 2,
  events = [] as Array<{ type: string; target?: string }>,
  navigated = [] as string[],
  prevent = false,
  hidden = false,
} = {}) => {
  const props = {
    state: { index, routes },
    descriptors: Object.fromEntries(
      routes.map((route) => [
        route.key,
        { options: { title: `title of ${route.name}` } },
      ])
    ),
    emitter: {
      emit: (event: { type: string; target?: string }) => {
        events.push(event);
        return { defaultPrevented: prevent };
      },
    },
    navigateToTab: (key: string) => navigated.push(key),
    insets: { top: 0, right: 0, bottom: 24, left: 0 },
    items: shown,
    hidden,
  } as unknown as TabBarProps;
  return elementTree(TabBar, props, (node) => (
    <ToastProvider>{node}</ToastProvider>
  )) as ReactElement<{ children: ReactNode; style: unknown; role: string }>;
};

type TabProps = {
  readonly role: string;
  readonly "aria-label": string;
  readonly "aria-selected": boolean;
  readonly onPress: () => void;
  readonly onLongPress: () => void;
  readonly children: (state: { pressed: boolean }) => ReactNode;
};
const tabs = (tree: ReactNode) =>
  findAll<TabProps>(tree, "Pressable").map((tab) => tab.props);
const content = (tab: TabProps, pressed = false) =>
  tab.children({ pressed }) as ReactElement<{ style: unknown }>;

describe("TabBar", () => {
  test("a hidden bar draws nothing", () => {
    expect(render({ hidden: true })).toBeNull();
  });

  test("lists the tabs in the navigator's order, each named by its title", () => {
    const tree = render();
    expect(tree.props.role).toBe("tablist");
    expect(tabs(tree).map((tab) => tab["aria-label"])).toEqual([
      "title of account",
      "title of book",
      "title of reservations",
    ]);
  });

  test("shows icons only: no visible titles", () => {
    const tree = render();
    for (const tab of tabs(tree)) {
      const shown = content(tab);
      expect(findAll(shown, "Text")).toHaveLength(0);
      expect(find(shown, Icon)).toBeDefined();
    }
  });

  test("the open tab is selected and tinted; the others are muted", () => {
    const [account, , reservations] = tabs(render({ index: 2 }));
    if (account === undefined || reservations === undefined)
      throw new Error("three tabs");
    expect(reservations["aria-selected"]).toBe(true);
    expect(account["aria-selected"]).toBe(false);
    expect(flatStyle(content(reservations).props.style)).toMatchObject({
      backgroundColor: color.actionTint,
    });
    expect(
      find<Parameters<typeof Icon>[0]>(content(reservations), Icon)?.props.color
    ).toBe(color.action);
    expect(
      find<Parameters<typeof Icon>[0]>(content(account), Icon)?.props.color
    ).toBe(color.ink2);
  });

  test("a tab's dot shows only when its item asks for it, hidden from assistive tech", () => {
    const dots = (tree: ReactNode) =>
      tabs(tree).map(
        (tab) =>
          findAll<{ "aria-hidden"?: boolean }>(content(tab), "View").filter(
            (view) => view.props["aria-hidden"] === true
          ).length
      );
    expect(dots(render())).toEqual([0, 0, 0]);
    expect(
      dots(
        render({
          items: { ...items, account: { icon: CircleUser, dot: true } },
        })
      )
    ).toEqual([1, 0, 0]);
  });

  test("the raised tab is a large orange circle reaching above the bar", () => {
    const book = tabs(render())[1];
    if (book === undefined) throw new Error("three tabs");
    const circle = flatStyle(content(book).props.style);
    expect(circle).toMatchObject({ backgroundColor: color.action });
    expect(circle.width).toBeGreaterThan(tabBarHeight);
    expect(circle.marginTop).toBeLessThan(0);
  });

  test("toasts clear the raised circle, not only the bar", () => {
    const height = tabBarHeight + 24;
    const book = tabs(render())[1];
    if (book === undefined) throw new Error("three tabs");
    const overhang = -(flatStyle(content(book).props.style).marginTop ?? 0);
    expect(tabBarObstruction(height, items, false)).toBe(height + overhang);
    expect(
      tabBarObstruction(height, { account: { icon: CircleUser } }, false)
    ).toBe(height);
    expect(tabBarObstruction(height, items, true)).toBe(0);
  });

  test("a white bar with no top border, above the bottom safe area", () => {
    const style = flatStyle(render().props.style);
    expect(style).toMatchObject({
      backgroundColor: color.surface,
      height: tabBarHeight + 24,
      paddingBottom: 24,
    });
    expect(style.borderTopWidth).toBeUndefined();
  });

  test("pressing another tab announces the press, then opens it", () => {
    const events: Array<{ type: string; target?: string }> = [];
    const navigated: string[] = [];
    tabs(render({ index: 2, events, navigated }))[0]?.onPress();
    expect(events.map((event) => [event.type, event.target])).toEqual([
      ["tabPress", "account-key"],
    ]);
    expect(navigated).toEqual(["account-key"]);
  });

  test("pressing the open tab only announces it, so its stack can return to its root", () => {
    const events: Array<{ type: string; target?: string }> = [];
    const navigated: string[] = [];
    tabs(render({ index: 2, events, navigated }))[2]?.onPress();
    expect(events).toHaveLength(1);
    expect(navigated).toEqual([]);
  });

  test("a prevented press stays put; a long press is announced", () => {
    const events: Array<{ type: string; target?: string }> = [];
    const navigated: string[] = [];
    const [account] = tabs(render({ events, navigated, prevent: true }));
    account?.onPress();
    account?.onLongPress();
    expect(navigated).toEqual([]);
    expect(events.map((event) => event.type)).toEqual([
      "tabPress",
      "tabLongPress",
    ]);
  });
});
