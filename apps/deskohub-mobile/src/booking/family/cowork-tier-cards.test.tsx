import { describe, expect, mock, test } from "bun:test";
import { act, Children, isValidElement, type ReactNode } from "react";
import { clientRoot } from "../../testing/client-root";
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

const renderCards = (
  onSelect: (tier: CoworkTierCard["tier"]) => void = () => undefined,
  shown: ReadonlyArray<CoworkTierCard> = cards
) =>
  elementTree(CoworkTierCards, {
    label: "Desk type",
    cards: shown,
    selected: "open-space",
    onSelect,
    locale: "en-US",
  });

const render = (
  onSelect?: (tier: CoworkTierCard["tier"]) => void,
  shown?: ReadonlyArray<CoworkTierCard>
) => {
  const tree = hostTree(renderCards(onSelect, shown));
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

  test("the Open Space and Reserved Desk artwork ends inside each card", () => {
    const { artFrames } = render();

    expect(artFrames.map((frame) => frame.right)).toEqual([0, 0]);
  });

  const root = clientRoot();

  test("the workstation artwork stays inside the card below the measured header", async () => {
    const card = {
      ...(cards[1] as CoworkTierCard),
      artwork: tierArtwork("reserved-desk", true),
    };
    const radio = findAll(renderCards(undefined, [card]), "Pressable")[0];
    const top = Children.toArray(radio?.props.children)[0];
    if (!isValidElement<HostProps>(top) || typeof top.type !== "function") {
      throw new Error("No card header");
    }
    const CardTop = top.type as (props: HostProps) => ReactNode;
    let tree: ReactNode = null;
    const Probe = () => {
      tree = CardTop(top.props);
      return null;
    };
    await root.render(<Probe />);
    expect(findAll(hostTree(tree), "Image")).toHaveLength(0);
    const onLayout = findAll(tree, "View")[0]?.props.onLayout;
    if (typeof onLayout !== "function")
      throw new Error("No header layout handler");

    const layout = { y: 12, height: 48 };
    await act(async () => onLayout({ nativeEvent: { layout } }));

    const frame = findAll(hostTree(tree), "View").find(
      (view) => view.props.pointerEvents === "none"
    );
    const style = flatStyle(frame?.props.style);
    expect(style.right).toBe(0);
    expect(style.top).toBeGreaterThan(layout.y + layout.height);
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
