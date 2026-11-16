import { describe, expect, test } from "bun:test";
import Mail from "lucide-react-native/icons/mail";
import { Icon } from "./icon";
import {
  elementTree,
  find,
  type HostProps,
  hostTree,
} from "./testing/element-tree";
import { color } from "./tokens";

describe("Icon", () => {
  test("draws the Lucide glyph at the design size, stroke 2, in navy, hidden from assistive technology", () => {
    const svg = find<HostProps>(
      hostTree(elementTree(Icon, { icon: Mail })),
      "Svg"
    );
    expect(svg?.props).toMatchObject({
      width: 24,
      height: 24,
      stroke: color.navy,
      strokeWidth: 2,
      accessible: false,
      importantForAccessibility: "no-hide-descendants",
    });
  });

  test("takes another size and colour", () => {
    const svg = find<HostProps>(
      hostTree(
        elementTree(Icon, { icon: Mail, size: 20, color: color.action })
      ),
      "Svg"
    );
    expect(svg?.props).toMatchObject({
      width: 20,
      height: 20,
      stroke: color.action,
    });
  });
});
