import { describe, expect, test } from "bun:test";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingIndicator } from "./loading-indicator";
import {
  MastheadClearance,
  ScrollScreen,
  useScrollScreenToTop,
} from "./scroll-screen";
import { elementTree, find, findAll, flatStyle } from "./testing/element-tree";
import { color, space } from "./tokens";

describe("ScrollScreen", () => {
  test("scrolls its content back to the top on request", () => {
    let scrollToTop: (() => void) | undefined;
    const Reader = () => {
      scrollToTop = useScrollScreenToTop();
      return null;
    };
    const tree = elementTree(ScrollScreen, { children: <Reader /> });
    const scrollView = find(tree, "ScrollView");
    const scrolls: Array<unknown> = [];
    (scrollView?.props.ref as RefObject<unknown>).current = {
      scrollTo: (options: unknown) => scrolls.push(options),
    };

    // The ScrollView's content provides the request to the screen's children.
    const provider = scrollView?.props.children;
    if (!isValidElement(provider)) {
      throw new Error("ScrollScreen renders nothing inside its ScrollView");
    }
    renderToStaticMarkup(provider);
    scrollToTop?.();

    // Instantly, so the top is already in view as the screen returns.
    expect(scrolls).toEqual([{ y: 0, animated: false }]);
  });

  test("a scroll request outside a ScrollScreen does nothing", () => {
    let scrollToTop: (() => void) | undefined;
    elementTree(() => {
      scrollToTop = useScrollScreenToTop();
      return null;
    }, {});
    expect(() => scrollToTop?.()).not.toThrow();
  });

  test("content sits on the screen gutter", () => {
    const content = findAll(
      elementTree(ScrollScreen, { children: createElement("Content") }),
      "View"
    ).find((view) =>
      Children.toArray(view.props.children).some(
        (child) => isValidElement(child) && child.type === "Content"
      )
    );
    expect(flatStyle(content?.props.style)).toMatchObject({
      paddingHorizontal: space.gutter,
    });
  });

  test("a masthead leads the scrolling content, which overlaps its navy band by 40", () => {
    const tree = elementTree(ScrollScreen, {
      masthead: createElement("Masthead"),
      children: createElement("Content"),
    });
    const provider = find(tree, "ScrollView")?.props.children;
    if (!isValidElement<{ children: unknown }>(provider)) {
      throw new Error("ScrollScreen renders nothing inside its ScrollView");
    }
    const scrolled = Children.toArray(
      provider.props.children as ReactNode
    ) as ReactElement<{ children: ReactNode }>[];
    // Measured in a wrapper, so a collapsed header knows when it has gone.
    expect(find(scrolled[0], "Masthead")).toBeDefined();
    const [band, content] = Children.toArray(
      scrolled[1]?.props.children
    ) as ReactElement<{ style: unknown }>[];
    expect(flatStyle(band?.props.style)).toMatchObject({
      backgroundColor: color.navy,
      height: 40,
      position: "absolute",
      top: 0,
    });
    expect(flatStyle(content?.props.style)).toMatchObject({
      paddingTop: 0,
    });
  });

  test("without the overlap, content starts a step below the masthead's band", () => {
    const tree = elementTree(ScrollScreen, {
      masthead: createElement("Masthead"),
      overlap: false,
      children: createElement("Content"),
    });
    const provider = find(tree, "ScrollView")?.props.children;
    if (!isValidElement<{ children: unknown }>(provider)) {
      throw new Error("ScrollScreen renders nothing inside its ScrollView");
    }
    const scrolled = Children.toArray(
      provider.props.children as ReactNode
    ) as ReactElement<{ children: ReactNode }>[];
    const page = Children.toArray(scrolled[1]?.props.children) as ReactElement<{
      style: unknown;
    }>[];
    expect(page).toHaveLength(1);
    expect(flatStyle(page[0]?.props.style)).toMatchObject({
      paddingTop: space.lg,
    });
  });

  test("pull-to-refresh keeps the gesture but hides the native spinner", () => {
    const refresh = find(
      elementTree(ScrollScreen, {
        children: null,
        onRefresh: () => undefined,
      }),
      "ScrollView"
    )?.props.refreshControl as ReactElement<Record<string, unknown>>;
    expect(refresh.props).toMatchObject({
      tintColor: "transparent",
      colors: ["transparent"],
      progressBackgroundColor: "transparent",
    });
  });

  test("the shared loading indicator shows at the top only while refreshing", () => {
    const indicator = (refreshing: boolean) =>
      find(
        elementTree(ScrollScreen, {
          children: null,
          refreshing,
          onRefresh: () => undefined,
        }),
        LoadingIndicator
      );
    expect(indicator(true)?.props).toMatchObject({ size: "inline" });
    expect(indicator(false)).toBeUndefined();
  });

  test("a masthead clearance moves content past the 40 overlap, less the column gap", () => {
    const clearance = elementTree(MastheadClearance, {}) as {
      props: { style: unknown; "aria-hidden": boolean };
    };
    expect(clearance.props["aria-hidden"]).toBe(true);
    expect(flatStyle(clearance.props.style).height).toBe(40 - space.md);
  });
});
