import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { getLandingPageSaleBannerContent } from "../landing-page-sale-banner-content";
import {
  LandingPageSaleBanner,
  type LandingPageSaleBannerContent,
} from "./landing-page-sale-banner";

const content = {
  label: {
    template: "{title}: <discount>{adjustment}</discount> off cowork access!",
    title: "Summer focus",
    adjustment: "20%",
  },
  statusLabel: "Sale active",
  ctaLabel: "Book with discount",
  href: "/en-US/reserve/cowork",
} satisfies Omit<LandingPageSaleBannerContent, "adjustmentKind">;

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

describe("LandingPageSaleBanner", () => {
  test("keeps the icon-only mobile CTA accessible", () => {
    const { container } = render(
      <LandingPageSaleBanner
        content={{ ...content, adjustmentKind: "percentage" }}
      />
    );

    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe(
      content.ctaLabel
    );
  });

  test("highlights the discount value within the sale label", () => {
    const { container } = render(
      <LandingPageSaleBanner
        content={{ ...content, adjustmentKind: "percentage" }}
      />
    );
    const value = container.querySelector("[data-landing-sale-discount-value]");

    expect(value?.closest("p")?.textContent).toBe(
      "Summer focus: 20% off cowork access!"
    );
    expect(value?.textContent).toBe("20%");
    expect(value?.classList).toContain("text-sunset-yellow-ink");
  });

  test.each([
    ["en-US" as const, "Autumn <VIP>", "Autumn <VIP>: 20% off cowork access!"],
    [
      "en-US" as const,
      "Autumn {discount}",
      "Autumn {discount}: 20% off cowork access!",
    ],
    [
      "en-US" as const,
      "Autumn <b>VIP</b>",
      "Autumn <b>VIP</b>: 20% off cowork access!",
    ],
    [
      "cs-CZ" as const,
      "Autumn <VIP>",
      "Autumn <VIP>: sleva 20 % na coworkingové vstupy!",
    ],
    [
      "cs-CZ" as const,
      "Autumn {discount}",
      "Autumn {discount}: sleva 20 % na coworkingové vstupy!",
    ],
    [
      "cs-CZ" as const,
      "Autumn <b>VIP</b>",
      "Autumn <b>VIP</b>: sleva 20 % na coworkingové vstupy!",
    ],
  ])("renders the %s sale title %p as literal text", (locale, title, label) => {
    const { container } = render(
      <LandingPageSaleBanner
        content={getLandingPageSaleBannerContent({
          locale,
          reservationKind: "cowork",
          sale: {
            title,
            adjustment: { kind: "percentage", basisPoints: 2000 },
            products: [{ kind: "cowork" }],
          },
        })}
      />
    );
    const paragraph = container.querySelector("p");
    const values = container.querySelectorAll(
      "[data-landing-sale-discount-value]"
    );

    expect(paragraph?.textContent).toBe(label);
    expect(paragraph?.querySelector("b")).toBeNull();
    expect(values).toHaveLength(1);
    expect(values[0]?.textContent).toBe(locale === "cs-CZ" ? "20 %" : "20%");
    expect(values[0]?.classList).toContain("text-sunset-yellow-ink");
  });

  test.each([
    ["percentage" as const, ".lucide-percent"],
    ["fixed" as const, ".lucide-dollar-sign"],
  ])("renders the %s adjustment icon", (adjustmentKind, selector) => {
    const { container } = render(
      <LandingPageSaleBanner content={{ ...content, adjustmentKind }} />
    );

    expect(container.querySelector(selector)).not.toBeNull();
  });
});
