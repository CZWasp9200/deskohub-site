import { describe, expect, test } from "bun:test";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { m } from "../../i18n/messages";
import {
  elementTree,
  findAll,
  flatStyle,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { Text } from "../../ui/text";
import { color } from "../../ui/tokens";
import type { PragueDate } from "../selection/prague-date";
import { MonthCalendar } from "./month-calendar";

type CalendarProps = Parameters<typeof MonthCalendar>[0];

type DayButton = ReactElement<{
  readonly "aria-label": string;
  readonly "aria-disabled"?: boolean;
  readonly "aria-selected"?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: (state: { pressed: boolean }) => ReactNode;
}>;

const calendar = (props: Partial<CalendarProps> = {}) => {
  const pressed = {
    selected: [] as PragueDate[],
    explained: [] as PragueDate[],
  };
  const tree = elementTree(MonthCalendar, {
    label: "Date",
    locale: "en-US",
    dates: {
      earliest: "2026-11-10",
      latest: "2026-12-31",
      unavailable: new Set(["2026-11-20"]),
    },
    selected: undefined,
    onSelect: (date) => pressed.selected.push(date),
    previousMonthLabel: "previous",
    nextMonthLabel: "next",
    unavailableLabel: "unavailable",
    ...props,
  });
  return { tree, pressed };
};

/**
 * The calendar's buttons (days and paging), found by their props rather than
 * by element type: which `Pressable` react-native exports in a run depends on
 * the stand-ins other test files registered before this module loaded.
 */
const buttons = (node: ReactNode): ReadonlyArray<DayButton> => {
  if (!isValidElement<Partial<DayButton["props"]>>(node)) return [];
  const nested = Children.toArray(node.props.children as ReactNode).flatMap(
    buttons
  );
  return typeof node.props.onPress === "function" &&
    typeof node.props["aria-label"] === "string"
    ? [node as DayButton, ...nested]
    : nested;
};

// "Friday, November 20" in en-US.
const dayButton = (tree: ReactNode, day: number) =>
  buttons(tree).find((button) =>
    button.props["aria-label"]?.includes(`November ${day}`)
  ) as DayButton | undefined;

describe("MonthCalendar", () => {
  test("weekday names shrink to their column on one line, never split", () => {
    const { tree } = calendar();
    const week = findAll(tree, "View").find(
      (view) => view.props["aria-hidden"] === true
    );
    const names = findAll(week, Text);
    expect(names).toHaveLength(7);
    for (const name of names) {
      expect(name.props.numberOfLines).toBe(1);
      expect(name.props.adjustsFontSizeToFit).toBe(true);
    }
  });

  test("an unavailable day can't be pressed without an explanation to show", () => {
    const { tree } = calendar();
    expect(dayButton(tree, 20)?.props.disabled).toBe(true);
    expect(dayButton(tree, 20)?.props["aria-label"]).toContain("unavailable");
  });

  test("pressing an unavailable day reports it and never selects it", () => {
    const explained: PragueDate[] = [];
    const { tree, pressed } = calendar({
      onUnavailablePress: (date) => explained.push(date),
    });
    const day = dayButton(tree, 20);
    expect(day?.props.disabled).toBe(false);
    day?.props.onPress();
    expect(explained).toEqual(["2026-11-20"]);
    expect(pressed.selected).toEqual([]);
  });

  test("pressing an available day selects it", () => {
    const { tree, pressed } = calendar({ onUnavailablePress: () => undefined });
    dayButton(tree, 26)?.props.onPress();
    expect(pressed.selected).toEqual(["2026-11-26"]);
  });

  test("past days can't be pressed", () => {
    const { tree } = calendar({ onUnavailablePress: () => undefined });
    expect(dayButton(tree, 9)?.props.disabled).toBe(true);
  });

  test("today is named as today", () => {
    const { tree } = calendar({ today: "2026-11-10" });
    expect(dayButton(tree, 10)?.props["aria-label"]).toContain(
      m.booking_calendar_today_day({}, { locale: "en-US" })
    );
    expect(dayButton(tree, 11)?.props["aria-label"]).not.toContain(
      m.booking_calendar_today_day({}, { locale: "en-US" })
    );
  });

  test("a range's days read as selected", () => {
    const { tree } = calendar({
      selected: "2026-11-23",
      range: { start: "2026-11-23", end: "2026-11-25" },
    });
    expect(
      [22, 23, 24, 25, 26].map(
        (day) => dayButton(tree, day)?.props["aria-selected"]
      )
    ).toEqual([false, true, true, true, false]);
  });

  test("shows the day info in a live region kept mounted", () => {
    const live = (tree: ReactNode) =>
      findAll<{ "aria-live"?: string; children?: ReactNode }>(
        tree,
        "View"
      ).filter((view) => view.props["aria-live"] === "polite");
    const without = live(calendar().tree);
    const withInfo = live(
      calendar({ focusedDate: "2026-11-20", dayInfo: "full" }).tree
    );
    expect(without).toHaveLength(1);
    expect(withInfo).toHaveLength(1);
    expect(findAll(without[0], Text)).toHaveLength(0);
    expect(
      findAll(withInfo[0], Text).map((text) => textOf(text as never))
    ).toEqual(["full"]);
  });

  test("shows the legend unless told not to", () => {
    const legendTexts = (tree: ReactNode) =>
      findAll(tree, Text)
        .map((text) => textOf(text as never))
        .filter((text) =>
          [
            m.booking_calendar_legend_today({}, { locale: "en-US" }),
            m.booking_calendar_legend_unavailable({}, { locale: "en-US" }),
          ].some((legend) => legend === text)
        );
    expect(legendTexts(calendar().tree)).toHaveLength(2);
    expect(legendTexts(calendar({ legend: false }).tree)).toHaveLength(0);
  });

  test("a disabled calendar takes no presses", () => {
    const { tree } = calendar({
      disabled: true,
      onUnavailablePress: () => undefined,
    });
    expect(buttons(tree).every((button) => button.props.disabled)).toBe(true);
  });

  /** A day's drawing: its band (when in a range), disc and number, as host views. */
  const dayDrawing = (tree: ReactNode, day: number) => {
    const drawn = hostTree(
      dayButton(tree, day)?.props.children({ pressed: false })
    );
    const views = findAll<{ style?: unknown }>(drawn, "View").map((view) =>
      flatStyle(view.props.style)
    );
    const number = findAll<{ style?: unknown }>(drawn, "Text").map((text) =>
      flatStyle(text.props.style)
    )[0];
    return { views, number };
  };
  const disc = (views: ReadonlyArray<Readonly<Record<string, unknown>>>) =>
    views.find((style) => style.minWidth === 40);

  test("bands a range behind its days and fills both its ends", () => {
    const { tree } = calendar({
      selected: "2026-11-23",
      range: { start: "2026-11-23", end: "2026-11-25" },
    });
    const band = (day: number) =>
      dayDrawing(tree, day).views.find(
        (style) => style.backgroundColor === color.actionTint
      );
    expect(band(23)).toMatchObject({ left: "50%" });
    expect(band(24)).toMatchObject({ left: 0, right: 0 });
    expect(band(25)).toMatchObject({ right: "50%" });
    expect(band(26)).toBeUndefined();
    expect(
      [23, 24, 25].map(
        (day) => disc(dayDrawing(tree, day).views)?.backgroundColor
      )
    ).toEqual([color.action, undefined, color.action]);
  });

  test("every day's disc keeps one outer shadow, picked or not", () => {
    // Android squares a view that gains an outer shadow after it mounts.
    const { tree } = calendar({ selected: "2026-11-23" });
    const shadowOf = (day: number) =>
      String(disc(dayDrawing(tree, day).views)?.boxShadow);
    expect(shadowOf(24)).not.toContain("inset");
    expect(shadowOf(23)).not.toBe(shadowOf(24));
    expect(shadowOf(23).replace(/rgba\([^)]*\)/, "")).toBe(
      shadowOf(24).replace(/rgba\([^)]*\)/, "")
    );
  });

  test("strikes an unavailable day through and rings the focused one", () => {
    const { tree } = calendar({
      focusedDate: "2026-11-20",
      onUnavailablePress: () => undefined,
    });
    const full = dayDrawing(tree, 20);
    expect(full.views.some((style) => style.transform !== undefined)).toBe(
      true
    );
    expect(disc(full.views)).toMatchObject({ outlineColor: color.action });
    const open = dayDrawing(tree, 21);
    expect(open.views.some((style) => style.transform !== undefined)).toBe(
      false
    );
    expect(disc(open.views)?.outlineColor).toBeUndefined();
  });

  test("rings today and greys the days that can't be booked", () => {
    const { tree } = calendar({
      today: "2026-11-10",
      dates: {
        earliest: "2026-11-10",
        latest: "2026-11-27",
        unavailable: new Set(),
      },
    });
    expect(String(disc(dayDrawing(tree, 10).views)?.boxShadow)).toContain(
      color.navy
    );
    expect(String(disc(dayDrawing(tree, 11).views)?.boxShadow)).not.toContain(
      color.navy
    );
    const ink = (day: number) => dayDrawing(tree, day).number?.color;
    expect(ink(9)).not.toBe(color.navy);
    expect(ink(28)).toBe(ink(9));
    expect(ink(11)).toBe(color.navy);
  });
});
