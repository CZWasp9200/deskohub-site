import { describe, expect, mock, test } from "bun:test";
import {
  elementTree,
  findAll,
  flatStyle,
  type HostProps,
  hostTree,
} from "../../ui/testing/element-tree";
import { czk } from "../testing/sample-booking-catalog";
import {
  type CoworkTierCard,
  CoworkTierCards,
  tierArtwork,
} from "./cowork-tier-cards";

const cards: ReadonlyArray<CoworkTierCard> = [
  {
    tier: "open-space",
    name: "Open Space",
    price: czk(232),
    was: czk(290),
    description: "Sit wherever you like.",
    artwork: tierArtwork("open-space", false),
  },
  {
    tier: "reserved-desk",
    name: "Reserved Desk",
    price: czk(328),
    description: "Your own desk.",
    artwork: tierArtwork("reserved-desk", false),
    unavailable: "Fully booked",
  },
];

const render = (
  onSelect = mock(() => undefined),
  shown: ReadonlyArray<CoworkTierCard> = cards
) => {
  const tree = hostTree(
    elementTree(CoworkTierCards, {
      label: "Desk type",
      cards: shown,
      selected: "open-space",
      onSelect,
      locale: "en-US",
    })
  );
  return {
    tree,
    radios: findAll(tree, "Pressable").map((radio) => radio.props),
    images: findAll(tree, "Image").map((image) => image.props),
    artFrames: findAll(tree, "View")
      .filter((view) => view.props.pointerEvents === "none")
      .map((view) => flatStyle(view.props.style)),
  };
};

const press = (radio: HostProps | undefined) => {
  const onPress = radio?.onPress;
  if (typeof onPress !== "function") throw new Error("Nothing to press");
  onPress();
};

describe("CoworkTierCards", () => {
  test("is one radio group with a radio per tier, the drafted one checked", () => {
    const { tree, radios } = render();

    expect(findAll(tree, "View")[0]?.props.role).toBe("radiogroup");
    expect(radios.map((radio) => radio.role)).toEqual(["radio", "radio"]);
    expect(radios.map((radio) => radio["aria-checked"])).toEqual([true, false]);
  });

  test("a tier that can't be chosen is disabled and never selected", () => {
    const onSelect = mock(() => undefined);
    const { radios } = render(onSelect);

    expect(radios[1]?.disabled).toBe(true);
    press(radios[0]);
    expect(onSelect).toHaveBeenCalledWith("open-space");
  });

  test("the artwork is a decorative background, hidden from assistive tech", () => {
    const { images } = render();

    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image["aria-hidden"]).toBe(true);
    }
  });

  test("the Open Space art ends inside the card instead of being trimmed", () => {
    const { artFrames } = render();

    expect(artFrames[0]?.right).toBe(0);
  });

  test("the workstation art waits for the name and radio to be measured", () => {
    const { images } = render(undefined, [
      cards[0] as CoworkTierCard,
      {
        ...(cards[1] as CoworkTierCard),
        artwork: tierArtwork("reserved-desk", true),
      },
    ]);

    expect(images.map((image) => image.source)).toEqual([
      tierArtwork("open-space", false).source,
    ]);
  });

  test("the Reserved Desk shows its workstation once one is added", () => {
    expect(tierArtwork("reserved-desk", true)).not.toBe(
      tierArtwork("reserved-desk", false)
    );
    expect(tierArtwork("open-space", true)).toBe(
      tierArtwork("open-space", false)
    );
  });
});
