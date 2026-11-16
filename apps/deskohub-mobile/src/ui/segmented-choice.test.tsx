import { describe, expect, mock, test } from "bun:test";
import Moon from "lucide-react-native/icons/moon";
import Sun from "lucide-react-native/icons/sun";
import { SegmentedChoice } from "./segmented-choice";
import { elementTree, find, findAll, hostTree } from "./testing/element-tree";

type Value = "day" | "overnight";

const choice = ({
  onSelect = () => undefined,
  disabled,
}: {
  readonly onSelect?: (value: Value) => void;
  readonly disabled?: boolean;
} = {}) => {
  const tree = hostTree(
    elementTree(SegmentedChoice<Value>, {
      label: "label",
      options: [
        { value: "day", icon: Sun, label: "A" },
        { value: "overnight", icon: Moon, label: "B" },
      ],
      selected: "overnight",
      onSelect,
      disabled,
    })
  );
  return {
    group: find(tree, "View")?.props,
    radios: findAll(tree, "Pressable").map((radio) => radio.props),
  };
};

describe("SegmentedChoice", () => {
  test("its label names the radio group", () => {
    const { group } = choice();
    expect(group?.role).toBe("radiogroup");
    expect(group?.["aria-label"]).toBe("label");
  });

  test("each option is a radio and only the chosen one is checked", () => {
    const { radios } = choice();
    expect(radios.map((radio) => radio.role)).toEqual(["radio", "radio"]);
    expect(radios.map((radio) => radio["aria-checked"])).toEqual([false, true]);
  });

  test("pressing an option chooses it", () => {
    const onSelect = mock((_value: Value) => undefined);
    const [day] = choice({ onSelect }).radios;
    if (typeof day?.onPress !== "function") throw new Error("No day radio");
    day.onPress();
    expect(onSelect).toHaveBeenCalledWith("day");
  });

  test("a disabled choice disables every option", () => {
    expect(
      choice({ disabled: true }).radios.map((radio) => radio.disabled)
    ).toEqual([true, true]);
  });
});
