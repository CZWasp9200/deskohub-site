import { describe, expect, test } from "bun:test";
import type {
  CustomerOffering,
  CustomerReservationFamily,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { czk, sampleOfferings } from "../testing/sample-booking-catalog";
import {
  pairFits,
  type SpaceRow,
  spaceCards,
  spaceRows,
} from "./space-chooser";

const catalog = sampleOfferings("en-US", "2026-11-10").offerings;

const without = (...families: ReadonlyArray<CustomerReservationFamily>) =>
  catalog.filter(({ family }) => !families.includes(family));

const layout = (rows: ReadonlyArray<SpaceRow>) =>
  rows.map((row) => row.map(({ family }) => family));

const cardOf = (
  offerings: ReadonlyArray<CustomerOffering>,
  family: CustomerReservationFamily
) => {
  const card = spaceCards(offerings).find((each) => each.family === family);
  if (card === undefined) throw new Error(`no ${family} card`);
  return card;
};

describe("spaceRows", () => {
  test("puts the office and meeting room side by side, the cowork desk under them", () => {
    expect(layout(spaceRows(spaceCards(catalog), true))).toEqual([
      ["office", "meeting-room"],
      ["cowork"],
    ]);
  });

  test("gives a lone office or meeting room the full row", () => {
    expect(layout(spaceRows(spaceCards(without("office")), true))).toEqual([
      ["meeting-room"],
      ["cowork"],
    ]);
    expect(
      layout(spaceRows(spaceCards(without("meeting-room")), true))
    ).toEqual([["office"], ["cowork"]]);
  });

  test("shows only the cowork desk when the other spaces are off", () => {
    expect(
      layout(spaceRows(spaceCards(without("office", "meeting-room")), true))
    ).toEqual([["cowork"]]);
  });

  test("stacks every card when two don't fit side by side", () => {
    expect(layout(spaceRows(spaceCards(catalog), false))).toEqual([
      ["office"],
      ["meeting-room"],
      ["cowork"],
    ]);
  });

  test("shows no card without offerings", () => {
    expect(spaceRows(spaceCards([]), true)).toEqual([]);
  });
});

describe("spaceCards", () => {
  test("names the office and the meeting room as the catalog does", () => {
    for (const family of ["office", "meeting-room"] as const) {
      const offering = catalog.find((each) => each.family === family);
      expect(cardOf(catalog, family).name).toEqual(
        Option.fromNullishOr(offering?.name)
      );
    }
    // The cowork family has a product per tier: the card names the family.
    expect(Option.isNone(cardOf(catalog, "cowork").name)).toBe(true);
  });

  test("starts the office from its advertised day with one seat, up to its seats", () => {
    // Not the live office's capacity, so a hard-coded maximum fails.
    const maximumSeats = 4;
    const offerings = catalog.map((each) =>
      each.family === "office" ? { ...each, maximumSeats } : each
    );
    const office = offerings.find((each) => each.family === "office");
    if (office?.family !== "office") throw new Error("no office");

    expect(cardOf(offerings, "office")).toMatchObject({
      fromPrice: office.advertisedPrice.price,
      unit: { kind: "day" },
      facts: { kind: "office-seats", maximum: maximumSeats },
    });
  });

  test("says only that the office is open around the clock while its seats are unknown", () => {
    const offerings = catalog.map((each) => {
      if (each.family !== "office") return each;
      const { maximumSeats: _, ...rest } = each;
      return rest;
    });
    expect(cardOf(offerings, "office").facts).toEqual({ kind: "always-open" });
  });

  test("starts the meeting room from its hourly price, with the catalog's capacity", () => {
    const hourly = catalog.find(
      (each) => each.family === "meeting-room" && each.duration === "hour:1"
    );
    if (hourly?.family !== "meeting-room") throw new Error("no hourly room");
    const capacity = hourly.facts.find(({ kind }) => kind === "capacity");

    expect(cardOf(catalog, "meeting-room")).toMatchObject({
      fromPrice: hourly.advertisedPrice.price,
      unit: { kind: "hour" },
      facts: { kind: "catalog", text: capacity?.text },
    });
  });

  test("without an hourly length, starts the meeting room from its cheapest length", () => {
    const lengths = catalog.filter(
      (each) => each.family === "meeting-room" && each.duration !== "hour:1"
    );
    const card = cardOf(lengths, "meeting-room");
    const cheapest = lengths.reduce((low, each) =>
      each.advertisedPrice.price.value < low.advertisedPrice.price.value
        ? each
        : low
    );
    if (cheapest.family !== "meeting-room") throw new Error("no room");

    expect(card.fromPrice).toEqual(cheapest.advertisedPrice.price);
    expect(card.unit).toEqual({
      kind: "length",
      label: cheapest.durationLabel,
    });
  });

  test("starts the cowork desk from its cheapest tier per day, open around the clock", () => {
    const lowest = Math.min(
      ...catalog
        .filter(({ family }) => family === "cowork")
        .map(({ advertisedPrice }) => advertisedPrice.price.value)
    );
    expect(cardOf(catalog, "cowork")).toMatchObject({
      fromPrice: { value: lowest },
      unit: { kind: "day" },
      facts: { kind: "always-open" },
    });
  });

  test("compares prices across minor-unit exponents", () => {
    const tiers = catalog.filter(({ family }) => family === "cowork");
    const [first, second] = tiers;
    if (first?.family !== "cowork" || second?.family !== "cowork") {
      throw new Error("two tiers expected");
    }
    const offerings = [
      {
        ...first,
        advertisedPrice: {
          ...first.advertisedPrice,
          price: { value: 500, exponent: 0, currency: "CZK" },
        },
      },
      {
        ...second,
        advertisedPrice: { ...second.advertisedPrice, price: czk(450) },
      },
    ];
    expect(cardOf(offerings, "cowork").fromPrice).toEqual(czk(450));
  });
});

describe("pairFits", () => {
  const phone = (contentWidth: number, fontScale: number) =>
    pairFits({ contentWidth, fontScale, gap: 12, padding: 10 });

  test("keeps two cards side by side on a 360 dp phone at normal text size", () => {
    expect(phone(360 - 32, 1)).toBe(true);
  });

  test("stacks them at 200% text size", () => {
    expect(phone(360 - 32, 2)).toBe(false);
    expect(phone(412 - 32, 2)).toBe(false);
  });
});
