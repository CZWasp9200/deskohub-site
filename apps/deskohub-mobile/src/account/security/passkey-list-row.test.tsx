import { describe, expect, test } from "bun:test";
import { ListRow } from "../../ui/list";
import { PasskeyListRow } from "./passkey-list-row";

const row = (disabled = false) => {
  const opened: Array<string> = [];
  const element = PasskeyListRow({
    name: "Synthetic phone",
    details: "Synthetic provider",
    menuLabel: "menu",
    disabled,
    onOpenMenu: () => opened.push("menu"),
  });
  return { element, opened };
};

// The menu is the row's own action, never a control nested inside a row
// that assistive technology reads as one element.
describe("PasskeyListRow", () => {
  test("is a list row action that opens the menu", () => {
    const { element, opened } = row();
    expect(element.type).toBe(ListRow);
    expect(element.props.kind).toBe("action");
    element.props.onPress();
    expect(opened).toEqual(["menu"]);
  });

  test("reads the menu it opens together with the passkey's details", () => {
    const { element } = row();
    expect(element.props.accessibilityLabel).toContain("menu");
    expect(element.props.accessibilityLabel).toContain("Synthetic provider");
  });

  test("its trailing ⋮ is a picture, not a second control", () => {
    const { element } = row();
    expect(element.props.trailing.props.onPress).toBeUndefined();
  });

  test("is disabled while a passkey is being added", () => {
    expect(row(true).element.props.disabled).toBe(true);
  });
});
