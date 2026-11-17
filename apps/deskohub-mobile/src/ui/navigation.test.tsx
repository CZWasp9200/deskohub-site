import { describe, expect, mock, test } from "bun:test";
import type { NativeStackHeaderProps } from "expo-router";
import { createElement } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

const replaced: unknown[] = [];
mock.module("expo-router", () =>
  expoRouterStandIn({
    useRouter: () => ({
      push: (_href: unknown) => undefined,
      replace: (href: unknown) => replaced.push(href),
    }),
  })
);
// Bun can't load expo-router's bundled React Navigation; its title rule is
// the string `headerTitle`, then `title`, then the route's name.
mock.module("expo-router/react-navigation", () => ({
  getHeaderTitle: (
    options: { readonly title?: string; readonly headerTitle?: unknown },
    fallback: string
  ) =>
    typeof options.headerTitle === "string"
      ? options.headerTitle
      : (options.title ?? fallback),
}));

const { AppBar } = await import("./app-bar");
const { FocusedStatusBar } = await import("./focused-status-bar");
const { StackHeader, stackScreenOptions, tabScreenOptions } = await import(
  "./navigation"
);
const { elementTree, find, flatStyle } = await import("./testing/element-tree");
const { color } = await import("./tokens");

const header = (
  props: Partial<NativeStackHeaderProps> & {
    readonly options?: NativeStackHeaderProps["options"];
  },
  goBack: () => void = () => undefined
) =>
  elementTree(
    StackHeader,
    {
      route: { key: "r", name: "route-name" },
      navigation: { goBack } as unknown as NativeStackHeaderProps["navigation"],
      options: {},
      ...props,
    },
    (component) =>
      createElement(
        SafeAreaInsetsContext.Provider,
        { value: { top: 24, right: 0, bottom: 0, left: 0 } },
        component
      )
  );

describe("stack headers", () => {
  test("each locale keeps one options object, drawn on the paper canvas", () => {
    expect(stackScreenOptions("cs-CZ")).toBe(stackScreenOptions("cs-CZ"));
    expect(stackScreenOptions("cs-CZ").contentStyle).toEqual({
      backgroundColor: color.paper,
    });
  });

  test("the header is the app bar below the top safe area, with dark status-bar content", () => {
    const tree = header({ options: { title: "title" } });
    expect(flatStyle(find(tree, "View")?.props.style)).toMatchObject({
      paddingTop: 24,
      backgroundColor: color.paper,
    });
    expect(find(tree, FocusedStatusBar)?.props.style).toBe("dark");
    expect(find(tree, AppBar)?.props.title).toBe("title");
  });

  test("a navy header draws the app bar on navy, with light status-bar content", () => {
    const headerRight = mock(() => null);
    const tree = header({
      options: { title: "title", headerRight },
      tone: "navy",
    } as never);
    expect(flatStyle(find(tree, "View")?.props.style)).toMatchObject({
      backgroundColor: color.navy,
    });
    expect(find(tree, FocusedStatusBar)?.props.style).toBe("light");
    expect(find(tree, AppBar)?.props.tone).toBe("navy");
    expect(headerRight).toHaveBeenCalledWith(
      expect.objectContaining({ tintColor: color.white })
    );
  });

  test("a string headerTitle wins over the title, and the route name is the last resort", () => {
    expect(
      find(
        header({ options: { title: "title", headerTitle: "header" } }),
        AppBar
      )?.props.title
    ).toBe("header");
    expect(find(header({}), AppBar)?.props.title).toBe("route-name");
  });

  test("back appears only with a screen to go back to, unless the screen hides it", () => {
    const back = { title: undefined, href: undefined };
    const goBacks: string[] = [];
    const onBack = (props: Parameters<typeof header>[0]) =>
      find(
        header(props, () => goBacks.push("back")),
        AppBar
      )?.props.onBack;
    expect(onBack({})).toBeUndefined();
    expect(
      onBack({ back, options: { headerBackVisible: false } })
    ).toBeUndefined();
    onBack({ back })?.();
    expect(goBacks).toEqual(["back"]);
  });

  test("with nothing behind the screen, back opens its fallback; with a screen behind, it goes back", () => {
    const goBacks: string[] = [];
    const onBack = (props: Parameters<typeof header>[0]) =>
      find(
        header(props, () => goBacks.push("back")),
        AppBar
      )?.props.onBack;
    onBack({ backFallback: "/reservations" } as never)?.();
    expect(replaced).toEqual(["/reservations"]);
    onBack({
      back: { title: undefined, href: undefined },
      backFallback: "/reservations",
    } as never)?.();
    expect(goBacks).toEqual(["back"]);
    expect(replaced).toEqual(["/reservations"]);
    expect(
      onBack({
        backFallback: "/reservations",
        options: { headerBackVisible: false },
      } as never)
    ).toBeUndefined();
  });

  test("headerRight becomes the app bar's actions", () => {
    const action = createElement("HeaderAction");
    const calls: unknown[] = [];
    const bar = find(
      header({
        back: { title: undefined, href: undefined },
        options: {
          headerRight: (props) => {
            calls.push(props);
            return action;
          },
        },
      }),
      AppBar
    );
    expect(bar?.props.actions).toBe(action);
    expect(calls).toEqual([{ tintColor: color.navy, canGoBack: true }]);
  });

  test("headerShadowVisible raises the bar", () => {
    expect(find(header({}), AppBar)?.props.raised).toBe(false);
    expect(
      find(header({ options: { headerShadowVisible: true } }), AppBar)?.props
        .raised
    ).toBe(true);
  });
});

describe("tab scenes", () => {
  test("sit on the paper canvas under their stacks' own headers", () => {
    expect(tabScreenOptions).toEqual({
      headerShown: false,
      sceneStyle: { backgroundColor: color.paper },
    });
  });
});
