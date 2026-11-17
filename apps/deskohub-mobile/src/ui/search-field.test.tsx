import { describe, expect, test } from "bun:test";
import { SearchField } from "./search-field";
import { find, flatStyle, hostTree } from "./testing/element-tree";
import { color } from "./tokens";

const onChangeText = () => undefined;

const field = () =>
  hostTree(
    <SearchField
      placeholder="placeholder"
      value="cz"
      onChangeText={onChangeText}
    />
  );

describe("SearchField", () => {
  test("a search box named by its placeholder, without autocorrect", () => {
    const input = find(field(), "TextInput")?.props;
    expect(input).toMatchObject({
      role: "searchbox",
      "aria-label": "placeholder",
      placeholder: "placeholder",
      value: "cz",
      onChangeText,
      returnKeyType: "search",
      autoCorrect: false,
      autoCapitalize: "none",
    });
    expect(input?.autoFocus).toBeUndefined();
  });

  test("a magnifier leads the input inside the idle field frame", () => {
    const frame = find(field(), "View");
    expect(flatStyle(frame?.props.style)).toMatchObject({
      borderColor: color.field,
      borderWidth: 1,
      minHeight: 52,
    });
    expect(flatStyle(frame?.props.style).height).toBeUndefined();
    expect(find(frame, "Svg")).toBeDefined();
  });
});
