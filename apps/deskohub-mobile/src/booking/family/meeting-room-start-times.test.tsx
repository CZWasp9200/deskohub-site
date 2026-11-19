import { describe, expect, mock, test } from "bun:test";
import {
  elementTree,
  findAll,
  type HostProps,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import type { MeetingRoomStartChoice } from "../selection/meeting-room-selection";
import {
  MeetingRoomStartTimes,
  startTimeColumns,
} from "./meeting-room-start-times";

const choice = (startTime: string, taken = false): MeetingRoomStartChoice => ({
  startTime,
  taken,
  earlySetupAvailable: !taken,
});

const daytime = [
  choice("08:00"),
  choice("09:00", true),
  choice("10:00"),
  choice("11:00"),
];
const outside = [choice("07:00"), choice("21:00", true)];

const render = (
  selected: string | undefined,
  onSelect = mock((_startTime: string) => undefined)
) => {
  const tree = hostTree(
    elementTree(MeetingRoomStartTimes, {
      label: "Start time",
      daytime,
      outside,
      selected,
      onSelect,
      locale: "en-US",
    })
  );
  const pressables = findAll(tree, "Pressable").map((node) => node.props);
  return {
    tree,
    chips: pressables.filter((props) => props.role === "radio"),
    disclosure: pressables.find((props) => props.role === "button"),
  };
};

const timesOf = (tree: unknown) =>
  findAll(tree as never, "Pressable")
    .filter((node) => node.props.role === "radio")
    .map((node) => textOf(findAll(node, "Text")[0] as never));

const press = (props: HostProps | undefined) => {
  const onPress = props?.onPress;
  if (typeof onPress !== "function") throw new Error("Nothing to press");
  onPress();
};

describe("MeetingRoomStartTimes", () => {
  test("shows the daytime starts in a radio group and keeps the rest behind a closed disclosure", () => {
    const { tree, disclosure } = render(undefined);

    expect(findAll(tree, "View")[1]?.props.role).toBe("radiogroup");
    expect(timesOf(tree)).toEqual(["08:00", "09:00", "10:00", "11:00"]);
    expect(disclosure?.["aria-expanded"]).toBe(false);
  });

  test("a taken start is disabled, named as taken and never chosen", () => {
    const onSelect = mock((_startTime: string) => undefined);
    const { chips } = render("09:00", onSelect);
    const taken = chips[1];

    expect(taken?.disabled).toBe(true);
    expect(taken?.["aria-disabled"]).toBe(true);
    expect(taken?.["aria-checked"]).toBe(false);
    expect(taken?.["aria-label"]).toEqual(expect.any(String));
    expect(chips[0]?.["aria-label"]).toBeUndefined();
  });

  test("checks the chosen start and chooses a free one on press", () => {
    const onSelect = mock((_startTime: string) => undefined);
    const { chips } = render("10:00", onSelect);

    expect(chips.map((chip) => chip["aria-checked"])).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(chips.map((chip) => chip.tabIndex)).toEqual([-1, -1, 0, -1]);
    press(chips[2]);
    expect(onSelect).not.toHaveBeenCalled();
    press(chips[3]);
    expect(onSelect).toHaveBeenCalledWith("11:00");
  });

  test("opens by itself, in time order, when the chosen start is an early or late one", () => {
    const { tree, disclosure } = render("07:00");

    expect(timesOf(tree)).toEqual([
      "07:00",
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "21:00",
    ]);
    expect(disclosure).toBeUndefined();
  });
});

describe("startTimeColumns", () => {
  test("fits five times in the wide column and two in an expanded track", () => {
    expect(startTimeColumns(640, 1, 5)).toBe(5);
    expect(startTimeColumns(280, 1, 2)).toBe(2);
    expect(startTimeColumns(440, 2, 5)).toBeLessThan(5);
  });

  test("fits four chips a row at the normal font size on a 360 px phone", () => {
    expect(startTimeColumns(328, 1)).toBe(4);
    expect(startTimeColumns(0, 1)).toBe(4);
  });

  test("drops columns as the font grows, down to one", () => {
    expect(startTimeColumns(328, 2)).toBeLessThan(4);
    expect(startTimeColumns(328, 2)).toBeGreaterThanOrEqual(2);
    expect(startTimeColumns(120, 2)).toBe(1);
  });
});
