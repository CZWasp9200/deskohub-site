import { describe, expect, test } from "bun:test";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { type Locale, m } from "@/features/i18n";
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

const bannerTemplate = (
  message: typeof m.landingSaleBannerAllProducts,
  locale: Locale = "en-US"
) => message({ title: "{title}", adjustment: "{adjustment}" }, { locale });

const summerFocusLabel = (template: string) => ({
  template,
  title: "Summer focus",
  adjustment: "20%",
});

describe("getLandingPageSaleBannerLabel", () => {
  test("describes a sale on every product without clarification", () => {
    expect(
      formatLabel([coworkProduct, meetingRoomProduct, officeProduct])
    ).toEqual(summerFocusLabel(bannerTemplate(m.landingSaleBannerAllProducts)));
  });

  test("describes a sale on every cowork product", () => {
    expect(formatLabel([coworkProduct])).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerAllCoworkProducts))
    );
  });

  test("describes a sale on every cowork tier as every cowork product", () => {
    expect(
      formatLabel([
        { kind: "cowork", tier: "open-space" },
        { kind: "cowork", tier: "reserved-desk" },
      ])
    ).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerAllCoworkProducts))
    );
  });

  test("uses the selected-products fallback for a single cowork tier", () => {
    expect(formatLabel([{ kind: "cowork", tier: "reserved-desk" }])).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
    expect(
      formatLabel([
        { kind: "cowork", tier: "open-space" },
        meetingRoomProduct,
        officeProduct,
      ])
    ).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
  });

  test("describes a sale on every meeting-room product", () => {
    expect(formatLabel([meetingRoomProduct])).toEqual(
      summerFocusLabel(
        bannerTemplate(m.landingSaleBannerAllMeetingRoomProducts)
      )
    );
  });

  test("uses the selected-products fallback for a family mix", () => {
    expect(formatLabel([coworkProduct, meetingRoomProduct])).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
  });

  test("does not omit office from a mixed sale label", () => {
    expect(formatLabel([coworkProduct, officeProduct])).toEqual(
      summerFocusLabel(bannerTemplate(m.landingSaleBannerSelectedProducts))
    );
  });

  test("formats fixed adjustments with their currency", () => {
    expect(
      formatLabel([coworkProduct], {
        kind: "fixed",
        amount: { value: 20_000, exponent: 2, currency: "CZK" },
      })
    ).toEqual({
      template: bannerTemplate(m.landingSaleBannerAllCoworkProducts),
      title: "Summer focus",
      adjustment: "CZK\u00a0200",
    });
  });

  test("localizes the template and adjustment for Czech", () => {
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
      template: bannerTemplate(m.landingSaleBannerAllCoworkProducts, "cs-CZ"),
      title: "Letní soustředění",
      adjustment: "20\u00a0%",
    });
  });
});

describe("getLandingPageSaleBannerContent", () => {
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
