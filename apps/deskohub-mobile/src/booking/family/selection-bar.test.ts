import { describe, expect, test } from "bun:test";
import type { CustomerBookingQuote } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  BookingCatalogViewError,
  type BookingQueryViewError,
} from "../data/booking-query-error";
import { czk } from "../testing/sample-booking-catalog";
import { openSpaceWithCoffee } from "../ui/testing/price-fixtures";
import { selectionBar } from "./selection-bar";

const from = { title: "Open Space", amount: czk(232), unit: "per day" };
const { selection, summary } = openSpaceWithCoffee;
const quote: CustomerBookingQuote = {
  family: "cowork",
  total: summary.total,
  regularPrice: czk(340),
  discount: czk(58),
  quotedAt: "2026-11-10T09:00:00.000Z",
  summary,
  advertisedPriceToken: "token",
};

const bar = (overrides: Partial<Parameters<typeof selectionBar>[0]> = {}) =>
  selectionBar({
    from,
    selection: Option.some(selection),
    quote: Option.none(),
    blocked: Option.none(),
    canContinue: false,
    locale: "en-US",
    ...overrides,
  });

describe("selectionBar", () => {
  test("before a date: the from-price, Continue off with the reason", () => {
    const shown = bar({
      selection: Option.none(),
      blocked: Option.some("reason"),
    });

    expect(shown.summary.title).toBe(from.title);
    expect(shown.summary.price).toEqual({
      kind: "from",
      amount: from.amount,
      unit: from.unit,
    });
    expect(shown).toMatchObject({
      action: "continue",
      disabled: true,
      reason: "reason",
    });
  });

  test("while quoting: the selection and Updating price", () => {
    const shown = bar({ quote: Option.some({ kind: "loading" }) });

    expect(shown.summary.price).toEqual({ kind: "updating" });
    expect(shown.summary.title).not.toBe(from.title);
    expect(shown.disabled).toBe(true);
  });

  test("quoted: the breakdown with the struck regular price, Continue on", () => {
    const shown = bar({
      quote: Option.some({ kind: "loaded", value: quote, refreshing: false }),
      canContinue: true,
    });

    expect(shown.summary.price).toMatchObject({
      kind: "quoted",
      was: czk(340),
    });
    expect(shown).toMatchObject({ action: "continue", disabled: false });
    expect(shown.reason).toBeUndefined();
  });

  test("a failed quote: no price, Try again when retrying can help", () => {
    const failed = (error: BookingQueryViewError) =>
      bar({
        quote: Option.some({
          kind: "failed",
          error,
          value: Option.none(),
          retrying: false,
        }),
      });

    expect(failed(CustomerViewError.Unavailable())).toMatchObject({
      summary: { price: { kind: "none" } },
      action: "retry",
      disabled: false,
    });
    expect(
      failed(BookingCatalogViewError.SelectionInvalid({ field: undefined }))
    ).toMatchObject({ action: "continue", disabled: true });
  });

  test("names the product by the catalog's name before and after a date", () => {
    const catalogName = "Catalog desk name";
    const named = { ...from, title: catalogName };

    const dated = selectionBar({
      from: named,
      selection: Option.some(selection),
      quote: Option.some({ kind: "loading" }),
      blocked: Option.none(),
      canContinue: false,
      locale: "en-US",
    });
    const quoted = selectionBar({
      from: named,
      selection: Option.some(selection),
      quote: Option.some({ kind: "loaded", value: quote, refreshing: false }),
      blocked: Option.none(),
      canContinue: true,
      locale: "en-US",
    });

    expect(dated.summary.detail?.startsWith(catalogName)).toBe(true);
    expect(quoted.summary.detail?.startsWith(catalogName)).toBe(true);
    if (quoted.summary.price.kind !== "quoted") throw new Error("not quoted");
    const { breakdown, describeLine } = quoted.summary.price;
    const product = breakdown.lines.find(
      (line) => line._tag === "Charge" && line.subject._tag === "Product"
    );
    if (product === undefined) throw new Error("no product line");
    expect(describeLine(product).label).toBe(catalogName);
  });
});
