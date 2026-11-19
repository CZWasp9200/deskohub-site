import type {
  CustomerOffering,
  CustomerReservationFamily,
  Money,
} from "@deskohub/workspace-customer-api";
import { Array as Arr, Option } from "effect";
import { coworkOfferings } from "../selection/cowork-selection";
import { meetingRoomOfferings } from "../selection/meeting-room-selection";
import { officeOfferingOf } from "./office-booking-model";

/** What a "from" price is for. */
export type SpaceUnit =
  | { readonly kind: "day" }
  | { readonly kind: "hour" }
  /** A meeting-room length other than an hour, by its catalog label. */
  | { readonly kind: "length"; readonly label: string };

/** The line under a space's name that says what it is for. */
export type SpaceFacts =
  /** A fact the catalog words, such as the meeting room's capacity. */
  | { readonly kind: "catalog"; readonly text: string }
  /** The office: from one seat to its maximum, around the clock. */
  | { readonly kind: "office-seats"; readonly maximum: number }
  | { readonly kind: "always-open" };

/** One space the Book tab offers, as its card shows it. */
export interface SpaceCard {
  readonly family: CustomerReservationFamily;
  /** The catalog's product name; absent for the cowork family's two tiers. */
  readonly name: Option.Option<string>;
  readonly facts: SpaceFacts;
  /** The advertised price the card starts from. */
  readonly fromPrice: Money;
  readonly unit: SpaceUnit;
}

/** A row of cards: one full-width card, or two sharing the row. */
export type SpaceRow =
  | readonly [SpaceCard]
  | readonly [SpaceCard, SpaceCard]
  | readonly [SpaceCard, SpaceCard, SpaceCard];

const cheaper = <
  A extends { readonly advertisedPrice: { readonly price: Money } },
>(
  left: A,
  right: A
) => {
  const l = left.advertisedPrice.price;
  const r = right.advertisedPrice.price;
  return r.value * 10 ** (l.exponent - r.exponent) < l.value ? right : left;
};

const cheapest = <
  A extends { readonly advertisedPrice: { readonly price: Money } },
>(
  offerings: ReadonlyArray<A>
): Option.Option<A> =>
  Arr.isReadonlyArrayNonEmpty(offerings)
    ? Option.some(
        Arr.reduce(
          Arr.tailNonEmpty(offerings),
          Arr.headNonEmpty(offerings),
          cheaper
        )
      )
    : Option.none();

const officeCard = (offerings: ReadonlyArray<CustomerOffering>) =>
  Option.map(
    officeOfferingOf(offerings),
    (office): SpaceCard => ({
      family: "office",
      name: Option.some(office.name),
      facts:
        office.maximumSeats !== undefined && office.maximumSeats > 1
          ? { kind: "office-seats", maximum: office.maximumSeats }
          : { kind: "always-open" },
      fromPrice: office.advertisedPrice.price,
      unit: { kind: "day" },
    })
  );

/**
 * The meeting room from its hourly price, as its screen's bar starts; without
 * an hourly length, from its cheapest length.
 */
const meetingRoomCard = (offerings: ReadonlyArray<CustomerOffering>) => {
  const lengths = meetingRoomOfferings(offerings);
  const hourly = lengths.find(({ duration }) => duration === "hour:1");
  return Option.map(
    hourly === undefined ? cheapest(lengths) : Option.some(hourly),
    (room): SpaceCard => {
      const capacity = room.facts.find(({ kind }) => kind === "capacity");
      return {
        family: "meeting-room",
        name: Option.some(room.name),
        facts:
          capacity === undefined
            ? { kind: "always-open" }
            : { kind: "catalog", text: capacity.text },
        fromPrice: room.advertisedPrice.price,
        unit:
          room.duration === "hour:1"
            ? { kind: "hour" }
            : { kind: "length", label: room.durationLabel },
      };
    }
  );
};

/** The cowork desk from its cheapest tier per day. */
const coworkCard = (offerings: ReadonlyArray<CustomerOffering>) =>
  Option.map(
    cheapest(coworkOfferings(offerings)),
    (tier): SpaceCard => ({
      family: "cowork",
      name: Option.none(),
      facts: { kind: "always-open" },
      fromPrice: tier.advertisedPrice.price,
      unit: { kind: "day" },
    })
  );

/**
 * The spaces the catalog offers, in the Book tab's order: the office, the
 * meeting room, then the cowork desk. A space the catalog leaves out, such
 * as the office while its release is off, has no card.
 */
export const spaceCards = (
  offerings: ReadonlyArray<CustomerOffering>
): ReadonlyArray<SpaceCard> =>
  Arr.getSomes([
    officeCard(offerings),
    meetingRoomCard(offerings),
    coworkCard(offerings),
  ]);

/**
 * The cards in rows: the office and the meeting room share a row when both
 * are offered and `pairFits`; every other card takes a full row, so a row
 * never has an empty half.
 */
export const spaceRows = (
  cards: ReadonlyArray<SpaceCard>,
  pairFits: boolean,
  expanded = false
): ReadonlyArray<SpaceRow> => {
  const office = cards.find(({ family }) => family === "office");
  const room = cards.find(({ family }) => family === "meeting-room");
  const cowork = cards.find(({ family }) => family === "cowork");
  if (expanded && office && room && cowork) {
    return [[office, room, cowork]];
  }
  if (expanded && cards.length === 2) {
    const [first, second] = cards;
    if (first && second) return [[first, second]];
  }
  if (!pairFits || office === undefined || room === undefined) {
    return cards.map((card): SpaceRow => [card]);
  }
  return [
    [office, room],
    ...cards
      .filter(({ family }) => family === "cowork")
      .map((card): SpaceRow => [card]),
  ];
};

/** The narrowest text column a half-width card keeps, at 100% text size. */
const halfCardMinimumText = 110;

/**
 * Whether the cards fit side by side in a content column `contentWidth`
 * wide: each half card's text column, scaled back to 100% text size, must
 * keep `halfCardMinimumText`, so a long name never breaks inside a word at a
 * large font size.
 */
export const spaceColumnsFit = ({
  columns,
  contentWidth,
  fontScale,
  gap,
  padding,
  minimumTextWidth = halfCardMinimumText,
}: {
  readonly columns: 2 | 3;
  readonly contentWidth: number;
  readonly fontScale: number;
  /** The space between the two cards. */
  readonly gap: number;
  /** A half card's text inset on each side. */
  readonly padding: number;
  /** Text width at the default font size for this card's type scale. */
  readonly minimumTextWidth?: number;
}) =>
  ((contentWidth - (columns - 1) * gap) / columns - 2 * padding) / fontScale >=
  minimumTextWidth;
