import { describe, expect, test } from "bun:test";
import {
  elementTree,
  findAll,
  flatStyle,
  hostTree,
} from "../../ui/testing/element-tree";
import { SpaceIllustration } from "./space-illustration";

const drawing = (props: Parameters<typeof SpaceIllustration>[0]) => {
  const tree = hostTree(elementTree(SpaceIllustration, props));
  const [image] = findAll(tree, "Image");
  return flatStyle(image?.props.style);
};

describe("SpaceIllustration", () => {
  test("shows the whole drawing on a half-width card", () => {
    for (const family of ["office", "meeting-room", "cowork"] as const) {
      expect(drawing({ family, height: 104, span: "half" })).toMatchObject({
        height: "100%",
        width: "100%",
      });
    }
  });

  test("enlarges the office to 140% of a full-width box, cropping only its top", () => {
    const style = drawing({ family: "office", height: 100, span: "full" });
    expect(style.height).toBeCloseTo(140);
    expect(style.top).toBeCloseTo(-40);
  });

  test("enlarges the meeting room, cropping 8% of the box off its bottom", () => {
    const style = drawing({
      family: "meeting-room",
      height: 100,
      span: "full",
    });
    expect(style.height).toBeCloseTo(140);
    expect((style.top as number) + (style.height as number)).toBeCloseTo(108);
  });

  test("keeps the whole cowork desk on a full-width card", () => {
    expect(
      drawing({ family: "cowork", height: 148, span: "full" })
    ).toMatchObject({ height: "100%", width: "100%" });
  });

  test("is hidden from assistive tech", () => {
    const tree = hostTree(
      elementTree(SpaceIllustration, {
        family: "office",
        height: 104,
        span: "half",
      })
    );
    const [box] = findAll(tree, "View");
    expect(box?.props["aria-hidden"]).toBe(true);
  });
});
