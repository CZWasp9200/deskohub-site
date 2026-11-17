import { describe, expect, mock, test } from "bun:test";
import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import {
  elementTree,
  findAll,
  flatStyle,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { sampleOfferings } from "../testing/sample-booking-catalog";
import { familyTitle } from "./booking-family-copy";
import { SpaceCards, SpaceCardsSkeleton } from "./space-cards";
import { spaceCards } from "./space-chooser";

const catalog = sampleOfferings("en-US", "2026-11-10").offerings;

const render = (
  families: ReadonlyArray<CustomerReservationFamily>,
  onOpen = mock((_: CustomerReservationFamily) => undefined)
) => {
  const tree = hostTree(
    elementTree(SpaceCards, {
      cards: spaceCards(
        catalog.filter(({ family }) => families.includes(family))
      ),
      locale: "en-US",
      onOpen,
    })
  );
  const buttons = findAll(tree, "Pressable");
  // Each card's picture box: decorative, at the board's height.
  const pictures = findAll(tree, "View")
    .filter((view) => view.props["aria-hidden"] === true)
    .map((view) => flatStyle(view.props.style).height);
  return { tree, buttons, pictures, onOpen };
};

describe("SpaceCards", () => {
  test("shows a link per space, each opening its space", () => {
    const { buttons, onOpen } = render(["office", "meeting-room", "cowork"]);

    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.props.role).toBe("link");
      expect(button.props.accessibilityLabel).toEqual(expect.any(String));
      (button.props.onPress as () => void)();
    }
    expect(onOpen.mock.calls.map(([family]) => family)).toEqual([
      "office",
      "meeting-room",
      "cowork",
    ]);
  });

  test("draws the office and meeting room as half cards over a full-width cowork card", () => {
    expect(render(["office", "meeting-room", "cowork"]).pictures).toEqual([
      104, 104, 148,
    ]);
  });

  test("draws a lone office or meeting room full width", () => {
    expect(render(["meeting-room", "cowork"]).pictures).toEqual([148, 148]);
    expect(render(["office", "cowork"]).pictures).toEqual([148, 148]);
  });

  test("shows the catalog's names and price on each card", () => {
    const { tree } = render(["office", "meeting-room", "cowork"]);
    const texts = findAll(tree, "Text").map((text) => textOf(text));
    for (const family of ["office", "meeting-room"] as const) {
      const name = catalog.find((each) => each.family === family)?.name;
      expect(texts).toContain(name ?? "");
    }
  });
});

describe("SpaceCards prices", () => {
  test("each card shows its own from-price with the unit it is charged in", () => {
    const families = ["office", "meeting-room", "cowork"] as const;
    const { buttons } = render(families);
    const cards = spaceCards(
      catalog.filter(({ family }) => families.includes(family))
    );
    expect(cards).toHaveLength(families.length);
    const unitOf = (card: (typeof cards)[number]) => {
      switch (card.unit.kind) {
        case "day":
          return m.booking_tier_price_per_day({}, { locale: "en-US" });
        case "hour":
          return m.booking_space_per_hour({}, { locale: "en-US" });
        case "length":
          return m.booking_space_per_length(
            { length: card.unit.label },
            { locale: "en-US" }
          );
      }
    };
    for (const card of cards) {
      const name = Option.getOrElse(card.name, () =>
        familyTitle(card.family, "en-US")
      );
      const own = buttons
        .map((button) => findAll(button, "Text").map((text) => textOf(text)))
        .find((texts) => texts.includes(name));
      expect(own).toContain(formatMoney(card.fromPrice, "en-US"));
      expect(own).toContain(unitOf(card));
    }
  });
});

describe("SpaceCardsSkeleton", () => {
  test("is one busy element in the cards' final layout", () => {
    const tree = hostTree(
      elementTree(SpaceCardsSkeleton, { label: "Loading" })
    );
    const busy = findAll(tree, "View").filter(
      (view) => view.props["aria-busy"] === true
    );
    expect(busy).toHaveLength(1);
    expect(findAll(tree, "Pressable")).toHaveLength(0);
  });
});
