import { describe, expect, test } from "bun:test";
import {
  elementTree,
  findAll,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { MeetingRoomHero } from "./meeting-room-hero";

const render = (facts: Parameters<typeof MeetingRoomHero>[0]["facts"]) =>
  hostTree(elementTree(MeetingRoomHero, { facts }));

describe("MeetingRoomHero", () => {
  test("shows the catalog's facts under a decorative illustration", () => {
    const tree = render([{ kind: "capacity", text: "Up to 10 seats" }]);

    const hidden = findAll(tree, "View").filter(
      (view) => view.props["aria-hidden"] === true
    );
    expect(hidden.flatMap((view) => findAll(view, "Image"))).toHaveLength(1);
    expect(findAll(tree, "Text").map((text) => textOf(text))).toEqual([
      "Up to 10 seats",
    ]);
  });

  test("shows only the illustration without facts", () => {
    expect(findAll(render([]), "Text")).toHaveLength(0);
  });
});
