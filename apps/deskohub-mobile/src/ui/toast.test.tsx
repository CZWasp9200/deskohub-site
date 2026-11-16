import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import {
  act,
  cloneElement,
  createElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { clientRoot } from "../testing/client-root";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";

// A focused screen runs its focus effect as React runs an effect.
const { useEffect } = await import("react");
mock.module("expo-router", () =>
  expoRouterStandIn({
    useFocusEffect: (effect: () => undefined | (() => void)) =>
      useEffect(effect, [effect]),
  })
);

const { Icon } = await import("./icon");
const { idleLiveRegionLayout } = await import("./notice-presentation");
const { elementTree, find, flatStyle } = await import("./testing/element-tree");
const { Text } = await import("./text");
const { Toast, ToastProvider, useToast, useToastObstruction } = await import(
  "./toast"
);
const { toastDurationMs } = await import("./toast-presentation");
const { color, radius, space } = await import("./tokens");

type ToastProps = Parameters<typeof Toast>[0];

const toast = (props: Partial<ToastProps> = {}) =>
  elementTree(Toast, {
    toast: undefined,
    bottom: 40,
    onDismiss: () => undefined,
    ...props,
  }) as ReactElement<{ style: unknown; children: ReactNode }>;

/** The toast's box: the slot's only child. */
const box = (tree: ReturnType<typeof toast>) =>
  tree.props.children as ReactElement<{ style: unknown }>;

/** The live region: the Text with a role. */
const region = (tree: ReturnType<typeof toast>) =>
  find(tree, Text)?.props as Record<string, unknown> | undefined;

describe("Toast", () => {
  test("sits the given distance above the bottom, inset from the sides", () => {
    expect(flatStyle(toast().props.style)).toMatchObject({
      position: "absolute",
      bottom: 40,
      left: space.md,
      right: space.md,
    });
  });

  test("with no toast its live region stays mounted, empty and out of the layout", () => {
    const idle = toast();
    expect(box(idle).props.style).toBe(idleLiveRegionLayout);
    expect(region(idle)).toMatchObject({
      role: "status",
      "aria-live": "polite",
      accessibilityLiveRegion: "polite",
      children: "",
    });
  });

  test("a confirmation is green and leads with the check in the accent colour", () => {
    const shown = toast({
      toast: { id: 1, message: "saved", tone: "confirmation" },
    });
    expect(flatStyle(box(shown).props.style)).toMatchObject({
      backgroundColor: color.positiveInk,
      borderRadius: radius.field,
    });
    expect(find(shown, Icon)?.props.color).toBe(color.positive);
    expect(region(shown)?.children).toBe("saved");
  });

  test("a neutral toast is navy, without the check", () => {
    const shown = toast({ toast: { id: 1, message: "off", tone: "neutral" } });
    expect(flatStyle(box(shown).props.style)).toMatchObject({
      backgroundColor: color.navy,
    });
    expect(find(shown, Icon)).toBeUndefined();
  });

  test("its action runs and dismisses that toast", () => {
    const events: unknown[] = [];
    const shown = toast({
      toast: {
        id: 7,
        message: "off",
        tone: "neutral",
        action: { label: "undo", onPress: () => events.push("undo") },
      },
      onDismiss: (id) => events.push(id),
    });
    const action = find(shown, "Pressable")?.props;
    if (!action) throw new Error("The toast drew no action");
    expect(action.role).toBe("button");
    (action.onPress as () => void)();
    expect(events).toEqual(["undo", 7]);
    const label = find(action.children, Text);
    expect(flatStyle(label?.props.style)).toMatchObject({
      color: color.toastAction,
    });
  });
});

describe("useToast", () => {
  test("needs a ToastProvider", () => {
    expect(() =>
      elementTree(() => {
        useToast();
        return null;
      }, {})
    ).toThrow();
  });
});

describe("ToastProvider", () => {
  const { render } = clientRoot();
  afterEach(async () => {
    jest.useRealTimers();
    await render(null);
  });

  // The provider runs inside a probe so its hooks and effects run, while
  // only `children` render in its context: the host components it returns
  // stand in as names and aren't drawn.
  let provided: ReactElement<{ children: ReactNode[] }> | undefined;
  const Probe = ({ children }: { readonly children?: ReactNode }) => {
    const tree = ToastProvider({ children }) as ReactElement;
    provided = find(tree, "View") as ReactElement<{ children: ReactNode[] }>;
    return cloneElement(tree, undefined, children);
  };
  const shownToast = () =>
    find(provided, Toast)?.props as ToastProps | undefined;

  test("shows a toast, replaces it with the next and dismisses it after 4 s", async () => {
    jest.useFakeTimers();
    let show: ReturnType<typeof useToast>["show"] = () => undefined;
    const Shower = () => {
      show = useToast().show;
      return null;
    };
    await render(createElement(Probe, null, createElement(Shower)));
    expect(shownToast()?.toast).toBeUndefined();

    await act(async () => show({ message: "first" }));
    await act(async () => jest.advanceTimersByTime(toastDurationMs - 1000));
    await act(async () => show({ message: "second", tone: "neutral" }));
    expect(shownToast()?.toast).toMatchObject({
      message: "second",
      tone: "neutral",
    });

    // The first toast's timer would have ended now; the second stays.
    await act(async () => jest.advanceTimersByTime(1000));
    expect(shownToast()?.toast?.message).toBe("second");
    await act(async () => jest.advanceTimersByTime(toastDurationMs));
    expect(shownToast()?.toast).toBeUndefined();
  });

  test("a focused layout's bottom chrome lifts toasts until it goes away", async () => {
    const Obstructing = () => {
      useToastObstruction(80);
      return null;
    };
    await render(createElement(Probe, null, createElement(Obstructing)));
    expect(shownToast()?.bottom).toBe(80 + space.md);
    await render(createElement(Probe));
    expect(shownToast()?.bottom).toBe(space.md);
  });
});
