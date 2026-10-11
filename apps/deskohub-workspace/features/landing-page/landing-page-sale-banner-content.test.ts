import { describe, expect, test } from "bun:test";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import {
  getLandingPageSaleBannerContent,
  getLandingPageSaleBannerLabel,
} from "./landing-page-sale-banner-content";

const coworkProduct = {
  kind: "cowork",
} as const satisfies WorkspaceProductTarget;
const meetingRoomProduct = {
  kind: "meeting-room",
} as const satisfies WorkspaceProductTarget;
const officeProduct = {
  kind: "office",
} as const satisfies WorkspaceProductTarget;

const formatLabel = (
  products: readonly WorkspaceProductTarget[],
  adjustment:
    | { readonly kind: "percentage"; readonly basisPoints: number }
    | {
        readonly kind: "fixed";
        readonly amount: {
          readonly value: number;
          readonly exponent: number;
          readonly currency: string;
        };
      } = { kind: "percentage", basisPoints: 2000 }
) =>
  getLandingPageSaleBannerLabel(
    {
      title: "Summer focus",
      adjustment,
      products,
    },
    "en-US"
  );

const summerFocusLabel = (template: string) => ({
  template,
  title: "Summer focus",
  adjustment: "20%",
});

describe("getLandingPageSaleBannerLabel", () => {
  test("describes a sale on every product without clarification", () => {
    expect(
      formatLabel([coworkProduct, meetingRoomProduct, officeProduct])
    ).toEqual(
      summerFocusLabel("{title}: <discount>{adjustment}</discount> off!")
    );
  });

  test("describes a sale on every cowork product", () => {
    expect(formatLabel([coworkProduct])).toEqual(
      summerFocusLabel(
        "{title}: <discount>{adjustment}</discount> off cowork access!"
      )
    );
  });

  test("describes a sale on every meeting-room product", () => {
    expect(formatLabel([meetingRoomProduct])).toEqual(
      summerFocusLabel(
        "{title}: <discount>{adjustment}</discount> off meeting room reservations!"
      )
    );
  });

  test("uses the selected-products fallback for a family mix", () => {
    expect(formatLabel([coworkProduct, meetingRoomProduct])).toEqual(
      summerFocusLabel(
        "{title}: <discount>{adjustment}</discount> off chosen products!"
      )
    );
  });

  test("does not omit office from a mixed sale label", () => {
    expect(formatLabel([coworkProduct, officeProduct])).toEqual(
      summerFocusLabel(
        "{title}: <discount>{adjustment}</discount> off chosen products!"
      )
    );
  });

  test("formats fixed adjustments with their currency", () => {
    expect(
      formatLabel([coworkProduct], {
        kind: "fixed",
        amount: { value: 20_000, exponent: 2, currency: "CZK" },
      })
    ).toEqual({
      template: "{title}: <discount>{adjustment}</discount> off cowork access!",
      title: "Summer focus",
      adjustment: "CZK 200",
    });
  });

  test("omits the redundant Czech quantifier", () => {
    expect(
      getLandingPageSaleBannerLabel(
        {
          title: "Letní soustředění",
          adjustment: { kind: "percentage", basisPoints: 2000 },
          products: [coworkProduct],
        },
        "cs-CZ"
      )
    ).toEqual({
      template:
        "{title}: sleva <discount>{adjustment}</discount> na coworkingové vstupy!",
      title: "Letní soustředění",
      adjustment: "20 %",
    });
  });
});

describe("getLandingPageSaleBannerContent", () => {
  test.each([
    ["percentage", { kind: "percentage" as const, basisPoints: 2000 }],
    [
      "fixed",
      {
        kind: "fixed" as const,
        amount: { value: 20_000, exponent: 2, currency: "CZK" },
      },
    ],
  ])("exposes the %s adjustment kind to the banner", (kind, adjustment) => {
    expect(
      getLandingPageSaleBannerContent({
        locale: "en-US",
        reservationKind: "cowork",
        sale: {
          title: "Summer focus",
          adjustment,
          products: [coworkProduct],
        },
      }).adjustmentKind
    ).toBe(kind);
  });

  test("attributes reservation visits to the home sale banner", () => {
    expect(
      getLandingPageSaleBannerContent({
        locale: "en-US",
        reservationKind: "meeting-room",
        sale: {
          title: "Summer focus",
          adjustment: { kind: "percentage", basisPoints: 2000 },
          products: [meetingRoomProduct],
        },
      }).href
    ).toBe(
      "/en-US/reservation/meeting-room?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero"
    );
  });

  test("links an office-only sale to the office reservation page", () => {
    expect(
      getLandingPageSaleBannerContent({
        locale: "en-US",
        reservationKind: "office",
        sale: {
          title: "Office week",
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [officeProduct],
        },
      }).href
    ).toBe(
      "/en-US/reservation/office?utm_source=deskohub&utm_medium=sale_banner&utm_content=home_hero"
    );
  });
});
