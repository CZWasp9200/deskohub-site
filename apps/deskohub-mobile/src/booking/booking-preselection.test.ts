import { describe, expect, test } from "bun:test";
import type { CustomerBookedSelection } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { bookAgainHref, bookingPreselectionOf } from "./booking-preselection";

/** The params expo-router hands a screen opened on `href`. */
const paramsOf = (href: string) =>
  Object.fromEntries(new URL(href, "https://app.invalid").searchParams);

const roundTrip = (booked: CustomerBookedSelection) =>
  bookingPreselectionOf(
    booked.selection.family,
    paramsOf(bookAgainHref(booked))
  );

describe("booking preselection", () => {
  test("a booked cowork selection opens its screen on the same selection", () => {
    const openSpace: CustomerBookedSelection = {
      selection: {
        family: "cowork",
        date: "2026-11-26",
        tier: "open-space",
        coffee: true,
      },
    };
    const reservedDesk: CustomerBookedSelection = {
      selection: {
        family: "cowork",
        date: "2026-11-26",
        tier: "reserved-desk",
        monitorOption: "2x27-4k",
      },
    };

    expect(bookAgainHref(openSpace).startsWith("/book/cowork?")).toBe(true);
    expect(roundTrip(openSpace)).toEqual(Option.some(openSpace));
    expect(roundTrip(reservedDesk)).toEqual(Option.some(reservedDesk));
  });

  test("a meeting room keeps its start, duration and early setup", () => {
    const booked: CustomerBookedSelection = {
      selection: {
        family: "meeting-room",
        date: "2026-11-26",
        duration: "hour:1",
        startTime: "14:00",
      },
      earlySetup: true,
    };

    expect(roundTrip(booked)).toEqual(Option.some(booked));
  });

  test("a screen opened without a selection starts empty", () => {
    expect(bookingPreselectionOf("cowork", {})).toEqual(Option.none());
    expect(
      bookingPreselectionOf("cowork", { restart: "hold_expired" })
    ).toEqual(Option.none());
  });

  test("params that don't name a selection are ignored", () => {
    expect(
      bookingPreselectionOf("cowork", {
        date: "26.11.2026",
        tier: "open-space",
      })
    ).toEqual(Option.none());
    expect(
      bookingPreselectionOf("cowork", { date: "2026-11-26", tier: "basic" })
    ).toEqual(Option.none());
  });
});
