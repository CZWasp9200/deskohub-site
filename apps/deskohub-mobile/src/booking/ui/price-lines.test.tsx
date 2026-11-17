import { describe, expect, test } from "bun:test";
import type { CustomerVatStatus } from "@deskohub/workspace-customer-api";
import type { ComponentProps, ReactElement } from "react";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { formatMoney, formatMoneyReduction } from "../../i18n/money-format";
import {
  elementTree,
  find,
  findAll,
  flatStyle,
  type HostProps,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { color } from "../../ui/tokens";
import { czk } from "../testing/sample-booking-catalog";
import { priceBreakdown } from "./price-breakdown";
import { describePriceLine } from "./price-line-description";
import { PriceLines } from "./price-lines";
import {
  openSpaceWithCoffee,
  reservedDeskWithWorkstation,
} from "./testing/price-fixtures";

const locale: AppLocale = "en-US";

const breakdownFor = (vatStatus: CustomerVatStatus) =>
  priceBreakdown({ ...openSpaceWithCoffee.summary, vatStatus });

const render = (props: Partial<ComponentProps<typeof PriceLines>> = {}) =>
  hostTree(
    elementTree(PriceLines, {
      breakdown: priceBreakdown(openSpaceWithCoffee.summary),
      describeLine: describePriceLine(openSpaceWithCoffee.selection, locale),
      locale,
      variant: "bar",
      ...props,
    })
  );

/** The rows that each read as one item. */
const rows = (tree: ReturnType<typeof render>) =>
  findAll(tree, "View").filter((view) => view.props.accessible === true);

const texts = (node: ReactElement<HostProps>) =>
  findAll(node, "Text").map(textOf);

describe("PriceLines", () => {
  test("shows each line with its amount, a discount as a reduction", () => {
    const tree = render();
    expect(rows(tree).map((row) => texts(row).at(-1))).toEqual([
      formatMoney(czk(290), locale),
      formatMoneyReduction(czk(58), locale),
      formatMoney(czk(50), locale),
    ]);
  });

  test("reads each line as one item: name, detail and amount", () => {
    const [product] = rows(render());
    expect(product?.props.accessibilityLabel).toBe(
      texts(product as ReactElement<HostProps>).join(", ")
    );
  });

  test("draws a discount line green, name and amount", () => {
    const [, discount] = rows(render());
    for (const text of findAll(discount, "Text")) {
      expect(flatStyle(text.props.style).color).toBe(color.positiveInk);
    }
  });

  test("reads a zero charge as free", () => {
    const { summary, selection } = reservedDeskWithWorkstation;
    const tree = render({
      breakdown: priceBreakdown({
        ...summary,
        sections: summary.sections.map((section) => ({
          ...section,
          items: section.items.map((item) =>
            item.key === "addon:workstation"
              ? { ...item, amount: czk(0) }
              : item
          ),
        })),
      }),
      describeLine: describePriceLine(selection, locale),
    });
    expect(texts(rows(tree).at(-1) as ReactElement<HostProps>).at(-1)).toBe(
      m.booking_price_free({}, { locale })
    );
  });

  test("the bar list has no total row, even when given one", () => {
    const tree = render({ total: { label: "Total" } });
    expect(texts(tree as ReactElement<HostProps>)).not.toContain("Total");
  });

  test("the card ends in the total, the earlier total struck above it", () => {
    const tree = render({
      variant: "card",
      total: { label: "Total", was: czk(340) },
    });
    const all = findAll(tree, "Text");
    const [was, total] = all.slice(-2);
    expect(textOf(was as ReactElement<HostProps>)).toBe(
      formatMoney(czk(340), locale)
    );
    expect(flatStyle(was?.props.style).textDecorationLine).toBe("line-through");
    expect(was?.props["aria-label"]).toBe(
      m.booking_checkout_summary_original_price(
        { amount: formatMoney(czk(340), locale) },
        { locale }
      )
    );
    expect(textOf(total as ReactElement<HostProps>)).toBe(
      formatMoney(czk(282), locale)
    );
  });

  test("a VAT payer's total shows the tax note under the total's label", () => {
    const withNote = texts(
      render({
        breakdown: breakdownFor("vat-payer"),
        variant: "card",
        total: { label: "Total", taxNote: "note" },
      }) as ReactElement<HostProps>
    );
    const without = texts(
      render({
        breakdown: breakdownFor("vat-payer"),
        variant: "card",
        total: { label: "Total" },
      }) as ReactElement<HostProps>
    );
    expect(withNote.length).toBe(without.length + 1);
    expect(withNote[withNote.indexOf("Total") + 1]).toBe("note");
  });

  test("a total from a seller who is not a VAT payer has no tax note and today's layout", () => {
    const today = render({
      breakdown: breakdownFor("not-vat-payer"),
      variant: "card",
      total: { label: "Total" },
    });
    const given = render({
      breakdown: breakdownFor("not-vat-payer"),
      variant: "card",
      total: { label: "Total", taxNote: "note" },
    });
    expect(openSpaceWithCoffee.summary.vatStatus).toBe("not-vat-payer");
    expect(texts(given as ReactElement<HostProps>)).not.toContain("note");
    expect(texts(given as ReactElement<HostProps>)).toEqual(
      texts(today as ReactElement<HostProps>)
    );
    expect(
      findAll(given, "View").map((view) => flatStyle(view.props.style))
    ).toEqual(
      findAll(today, "View").map((view) => flatStyle(view.props.style))
    );
  });

  test("the card's rows sit on a shared baseline, the bar's at the top", () => {
    const [cardRow] = rows(render({ variant: "card" }));
    const [barRow] = rows(render());
    expect(flatStyle(cardRow?.props.style).alignItems).toBe("baseline");
    expect(flatStyle(barRow?.props.style).alignItems).toBe("flex-start");
    expect(find(render(), "View")).toBeDefined();
  });
});
