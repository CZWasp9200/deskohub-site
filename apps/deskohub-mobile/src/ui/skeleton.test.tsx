import { afterEach, describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { clientRoot } from "../testing/client-root";
import { ListGroup } from "./list";
import { Skeleton, SkeletonGroup, SkeletonRow } from "./skeleton";
import {
  elementTree,
  find,
  findAll,
  type HostProps,
  hostTree,
} from "./testing/element-tree";

describe("SkeletonGroup", () => {
  test("is one busy progress element named by its label", () => {
    const view = find(
      hostTree(elementTree(SkeletonGroup, { rows: 2, label: "loading" })),
      "View"
    )?.props;
    expect(view?.accessible).toBe(true);
    expect(view?.role).toBe("progressbar");
    expect(view?.["aria-busy"]).toBe(true);
    expect(view?.["aria-label"]).toBe("loading");
  });

  test("lays out its rows as a list group, or its own blocks", () => {
    const rows = elementTree(SkeletonGroup, { rows: 3, label: "l" });
    expect(find(rows, ListGroup)).toBeDefined();
    expect(findAll(rows, SkeletonRow)).toHaveLength(3);
    const blocks = elementTree(SkeletonGroup, {
      label: "l",
      children: createElement(Skeleton, { width: "40%", height: 12 }),
    });
    expect(find(blocks, ListGroup)).toBeUndefined();
    expect(findAll(blocks, Skeleton)).toHaveLength(1);
  });
});

describe("SkeletonRow", () => {
  const blocks = (props: Parameters<typeof SkeletonRow>[0]) =>
    findAll(elementTree(SkeletonRow, props), Skeleton).length;

  test("shows an icon tile and two lines by default", () => {
    expect(blocks({})).toBe(3);
    expect(blocks({ lines: 1 })).toBe(2);
    expect(blocks({ icon: false, lines: 1 })).toBe(1);
  });

  test("is hidden from assistive tech, like every block", () => {
    expect(
      (elementTree(SkeletonRow, {}) as ReactElement<HostProps>).props[
        "aria-hidden"
      ]
    ).toBe(true);
    expect(
      (
        elementTree(Skeleton, {
          width: 10,
          height: 10,
        }) as ReactElement<HostProps>
      ).props["aria-hidden"]
    ).toBe(true);
  });
});

describe("pulse", () => {
  const { render } = clientRoot();
  const animated = Animated as unknown as {
    loop: (...args: never[]) => unknown;
  };
  const accessibility = AccessibilityInfo as unknown as {
    isReduceMotionEnabled: () => Promise<boolean>;
  };
  const { loop } = animated;
  const { isReduceMotionEnabled } = accessibility;
  afterEach(async () => {
    await render(null);
    animated.loop = loop;
    accessibility.isReduceMotionEnabled = isReduceMotionEnabled;
  });

  /** How many pulses a group starts while motion is `reduced`. */
  const pulses = async (reduced: boolean) => {
    let started = 0;
    animated.loop = () => ({
      start: () => {
        started++;
      },
      stop: () => undefined,
    });
    accessibility.isReduceMotionEnabled = async () => reduced;
    const Probe = () => {
      SkeletonGroup({ rows: 1, label: "l" });
      return null;
    };
    await render(createElement(Probe));
    return started;
  };

  test("pulses while motion is allowed", async () => {
    expect(await pulses(false)).toBe(1);
  });

  test("holds still under reduced motion", async () => {
    expect(await pulses(true)).toBe(0);
  });
});
