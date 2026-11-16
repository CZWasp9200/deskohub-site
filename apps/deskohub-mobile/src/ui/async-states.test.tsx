import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { clientRoot } from "../testing/client-root";
import { ErrorState, LoadingState, RefreshingIndicator } from "./async-states";
import { Button } from "./controls";
import { EmptyState } from "./empty-state";
import { LoadingIndicator } from "./loading-indicator";
import { idleLiveRegionLayout } from "./notice-presentation";
import {
  elementTree,
  find,
  findAll,
  flatStyle,
  hostTree,
} from "./testing/element-tree";

/** The component's live region: its only Text with a role. */
const liveRegion = <Props,>(
  component: Parameters<typeof elementTree<Props>>[0],
  props: Props
) =>
  findAll(hostTree(elementTree(component, props)), "Text").find(
    (text) => text.props.role !== undefined
  )?.props;

describe("loading indicators", () => {
  test("the first load shows a labelled brand die in place of the section", () => {
    expect(
      find(elementTree(LoadingState, { label: "loading" }), LoadingIndicator)
        ?.props
    ).toEqual({ size: "section", tone: "brand", label: "loading" });
  });

  test("a refresh draws no die of its own, only its status line", () => {
    for (const refreshing of [false, true]) {
      const tree = hostTree(
        elementTree(RefreshingIndicator, { refreshing, label: "refreshing" })
      );
      expect(find(tree, LoadingIndicator)).toBeUndefined();
      expect(find(tree, "Svg")).toBeUndefined();
    }
  });

  test("an idle refresh line takes no room above the content", () => {
    const style = (refreshing: boolean) =>
      flatStyle(
        liveRegion(RefreshingIndicator, { refreshing, label: "refreshing" })
          ?.style
      );
    expect(style(false)).toMatchObject(idleLiveRegionLayout);
    expect(style(true).position).not.toBe("absolute");
  });
});

// React Native's Text doesn't map `aria-live` to Android's live region, so
// each region declares `accessibilityLiveRegion` as well.
describe("error state", () => {
  const props = { message: "x", retryLabel: "retry", onRetry: () => undefined };

  test("is an empty state whose title is an assertive live region", () => {
    const empty = find(elementTree(ErrorState, props), EmptyState)?.props;
    expect(empty?.live).toBe("assertive");
    // Mounted empty: the message arrives after mount, so it is announced.
    expect(empty?.title).toBe("");
  });

  test("its retry button shows progress while the retry runs", () => {
    const retry = (retrying: boolean) =>
      find(elementTree(ErrorState, { ...props, retrying }), Button)?.props;
    expect(retry(true)?.busy).toBe(true);
    expect(retry(false)?.busy).toBe(false);
    expect(retry(false)?.onPress).toBe(props.onRetry);
  });

  test("with a title, shows the message under it", () => {
    const empty = find(
      elementTree(ErrorState, { ...props, title: "title" }),
      EmptyState
    )?.props;
    expect(empty?.body).toBe(props.message);
    expect(find(elementTree(ErrorState, props), EmptyState)?.props.body).toBe(
      undefined
    );
  });
});

describe("live regions", () => {
  test("the error state's region is an assertive alert", () => {
    const region = liveRegion(ErrorState, {
      message: "x",
      retryLabel: "retry",
      onRetry: () => undefined,
    });
    expect(region?.role).toBe("alert");
    expect(region?.["aria-live"]).toBe("assertive");
    expect(region?.accessibilityLiveRegion).toBe("assertive");
  });

  test("the refreshing indicator's region is a polite status, idle or shown", () => {
    for (const refreshing of [false, true]) {
      const region = liveRegion(RefreshingIndicator, {
        refreshing,
        label: "refreshing",
      });
      expect(region?.role).toBe("status");
      expect(region?.["aria-live"]).toBe("polite");
      expect(region?.accessibilityLiveRegion).toBe("polite");
    }
  });
});

// VoiceOver ignores `aria-live`, so on iOS each region announces its message
// itself, as politely as the region it declares.
describe("iOS announcements", () => {
  const { render } = clientRoot();
  const announced: Array<{ message: string; queue: boolean | undefined }> = [];
  const platform = Platform as { OS: string };
  const accessibility = AccessibilityInfo as {
    announceForAccessibilityWithOptions?: (
      message: string,
      options: { readonly queue?: boolean }
    ) => void;
  };
  let os = platform.OS;
  beforeEach(() => {
    os = platform.OS;
    platform.OS = "ios";
    announced.length = 0;
    accessibility.announceForAccessibilityWithOptions = (message, options) => {
      announced.push({ message, queue: options.queue });
    };
  });
  afterEach(async () => {
    await render(null);
    platform.OS = os;
    delete accessibility.announceForAccessibilityWithOptions;
  });

  // The component runs inside a probe so its hooks and effects run while the
  // host components it returns, which only stand in as names, aren't drawn.
  const announce = async <Props,>(
    component: (props: Props) => ReactNode,
    props: Props
  ) => {
    const Probe = () => {
      component(props);
      return null;
    };
    await render(createElement(Probe));
    return announced;
  };

  test("the refreshing indicator waits for current speech", async () => {
    expect(
      await announce(RefreshingIndicator, {
        refreshing: true,
        label: "refreshing",
      })
    ).toEqual([{ message: "refreshing", queue: true }]);
  });
});
