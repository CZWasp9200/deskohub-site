import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Calendar from "lucide-react-native/icons/calendar";
import { createElement, type ReactElement } from "react";
import { AccessibilityInfo, Platform, StyleSheet } from "react-native";
import { clientRoot } from "../testing/client-root";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import {
  elementTree,
  find,
  findAll,
  type HostProps,
} from "./testing/element-tree";
import { Text } from "./text";

const empty = (props: Partial<Parameters<typeof EmptyState>[0]> = {}) =>
  elementTree(EmptyState, {
    icon: Calendar,
    title: "t",
    ...props,
  }) as ReactElement<HostProps>;
const flat = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

describe("EmptyState", () => {
  test("shows the icon disc and title, then the body and actions it has", () => {
    expect(find<Parameters<typeof Icon>[0]>(empty(), Icon)?.props.icon).toBe(
      Calendar
    );
    expect(findAll(empty(), Text)).toHaveLength(1);
    expect(findAll(empty({ body: "b" }), Text)).toHaveLength(2);
    const actions = empty({ children: createElement("Pressable") });
    expect(find(actions, "Pressable")).toBeDefined();
  });

  test("draws its own outline only when dashed", () => {
    expect(flat(empty().props.style).borderWidth).toBeUndefined();
    expect(
      flat(empty({ dashed: true }).props.style).borderWidth
    ).toBeGreaterThan(0);
  });

  test("its title is plain text, or a live region when asked", () => {
    expect(find(empty(), Text)?.props.role).toBeUndefined();
    const alert = find(empty({ live: "assertive" }), Text)?.props;
    expect(alert?.role).toBe("alert");
    expect(alert?.accessibilityLiveRegion).toBe("assertive");
    const status = find(empty({ live: "polite" }), Text)?.props;
    expect(status?.role).toBe("status");
    expect(status?.["aria-live"]).toBe("polite");
  });

  test("a live title is read with the body under it", () => {
    const live = find(empty({ live: "assertive", body: "b" }), Text)?.props;
    expect(live?.accessibilityLabel).toEqual(expect.stringContaining("b"));
    const plain = find(empty({ body: "b" }), Text)?.props;
    expect(plain?.accessibilityLabel).toBeUndefined();
  });
});

// VoiceOver ignores `aria-live`, so on iOS a live title announces itself.
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
  const announce = async (props: Partial<Parameters<typeof EmptyState>[0]>) => {
    const Probe = () => {
      EmptyState({ icon: Calendar, title: "t", ...props });
      return null;
    };
    await render(createElement(Probe));
    return announced;
  };

  test("an assertive title interrupts current speech", async () => {
    expect(await announce({ live: "assertive" })).toEqual([
      { message: "t", queue: false },
    ]);
  });

  test("a live title is announced with its body", async () => {
    const [announcement] = await announce({ live: "assertive", body: "b" });
    expect(announcement?.message).toEqual(expect.stringContaining("b"));
  });

  test("a title that isn't live says nothing", async () => {
    expect(await announce({})).toEqual([]);
  });
});
