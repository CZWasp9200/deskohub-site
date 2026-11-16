import { describe, expect, mock, test } from "bun:test";
import {
  elementTree,
  findAll,
  type HostProps,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { czk } from "../testing/sample-booking-catalog";
import {
  type MeetingRoomLength,
  MeetingRoomLengths,
} from "./meeting-room-lengths";

const lengths: ReadonlyArray<MeetingRoomLength> = [
  { duration: "hour:1", label: "1 hour", price: czk(280), was: czk(350) },
  { duration: "hour:4", label: "4 hours", price: czk(980) },
  { duration: "day:1", label: "Whole day", price: czk(1820) },
];

const render = (
  selected: MeetingRoomLength["duration"] | undefined,
  onSelect = mock(() => undefined)
) => {
  const tree = hostTree(
    elementTree(MeetingRoomLengths, {
      label: "How long?",
      lengths,
      selected,
      onSelect,
      locale: "en-US",
    })
  );
  return {
    tree,
    radios: findAll(tree, "Pressable").map((radio) => radio.props),
  };
};

const press = (radio: HostProps | undefined) => {
  const onPress = radio?.onPress;
  if (typeof onPress !== "function") throw new Error("Nothing to press");
  onPress();
};

describe("MeetingRoomLengths", () => {
  test("is one radio group with a radio per length, none checked until one is chosen", () => {
    const { tree, radios } = render(undefined);

    expect(findAll(tree, "View")[0]?.props.role).toBe("radiogroup");
    expect(radios.map((radio) => radio.role)).toEqual([
      "radio",
      "radio",
      "radio",
    ]);
    expect(radios.map((radio) => radio["aria-checked"])).toEqual([
      false,
      false,
      false,
    ]);
    // The first row is the group's one tab stop.
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  });

  test("checks the chosen length and chooses another on press", () => {
    const onSelect = mock(() => undefined);
    const { radios } = render("hour:4", onSelect);

    expect(radios.map((radio) => radio["aria-checked"])).toEqual([
      false,
      true,
      false,
    ]);
    press(radios[1]);
    expect(onSelect).not.toHaveBeenCalled();
    press(radios[2]);
    expect(onSelect).toHaveBeenCalledWith("day:1");
  });

  test("strikes the regular price only above a discounted length", () => {
    const { tree } = render(undefined);
    const struck = findAll(tree, "Text").filter((text) =>
      [text.props.style]
        .flat(3)
        .some(
          (style) =>
            typeof style === "object" &&
            style !== null &&
            "textDecorationLine" in style &&
            style.textDecorationLine === "line-through"
        )
    );

    expect(struck).toHaveLength(1);
    expect(textOf(struck[0] as never)).toContain("350");
  });
});
