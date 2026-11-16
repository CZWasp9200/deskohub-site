import { describe, expect, mock, test } from "bun:test";
import Coffee from "lucide-react-native/icons/coffee";
import {
  elementTree,
  findAll,
  flatStyle,
  hostTree,
} from "../../ui/testing/element-tree";
import { AddonOptions, AddonToggle } from "./addon-toggle";

/** Presses a pressable's props; a missing handler fails the test. */
const press = (props: Readonly<Record<string, unknown>> | undefined) => {
  const onPress = props?.onPress;
  if (typeof onPress !== "function") throw new Error("Nothing to press");
  onPress();
};

describe("AddonToggle", () => {
  test("the whole card is one switch named by the extra", () => {
    const onToggle = mock((_checked: boolean) => undefined);
    const tree = hostTree(
      elementTree(AddonToggle, {
        label: "Coffee",
        icon: Coffee,
        checked: false,
        onToggle,
        price: "+ CZK 50",
      })
    );
    const [card, ...rest] = findAll(tree, "Pressable");

    expect(rest).toHaveLength(0);
    expect(card?.props).toMatchObject({
      role: "switch",
      "aria-label": "Coffee",
      "aria-checked": false,
    });
    press(card?.props);
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe("AddonOptions", () => {
  const render = (onSelect = mock((_value: string) => undefined)) =>
    findAll(
      hostTree(
        elementTree(AddonOptions<string>, {
          label: "Monitor workstation",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B", disabled: true },
            { value: "c", label: "C" },
          ],
          selected: "a",
          onSelect,
        })
      ),
      "Pressable"
    ).map((option) => option.props);

  test("lays the options out two to a row as radios, the chosen one checked", () => {
    const options = render();

    expect(options.map((option) => option.role)).toEqual([
      "radio",
      "radio",
      "radio",
    ]);
    expect(options.map((option) => option["aria-checked"])).toEqual([
      true,
      false,
      false,
    ]);
    // Another test file may replace Pressable, which then resolves a
    // style function itself; read the style either way.
    const style = options[0]?.style;
    const resolved =
      typeof style === "function" ? style({ pressed: false }) : style;
    expect(flatStyle(resolved).flexBasis).toBe("45%");
  });

  test("an option taken that day can't be chosen", () => {
    const onSelect = mock((_value: string) => undefined);
    const options = render(onSelect);

    expect(options[1]?.disabled).toBe(true);
    press(options[2]);
    expect(onSelect).toHaveBeenCalledWith("c");
  });
});
