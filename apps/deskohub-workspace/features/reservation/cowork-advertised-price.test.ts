import { describe, expect, test } from "bun:test";
import { canonicalPromotionCodeSchema } from "@/features/discounts";
import { getCoworkTierAdvertisedPriceRequests } from "./cowork-advertised-price";

const offers = [
  { entryTier: "open-space", coffee: true },
  { entryTier: "reserved-desk", coffee: true, monitorOption: "2x27-qhd" },
] as const;

describe("getCoworkTierAdvertisedPriceRequests", () => {
  test("leaves the discount code out when none was submitted", () => {
    const requests = getCoworkTierAdvertisedPriceRequests({
      date: "2099-07-30",
      locale: "en-US",
      offers,
    });

    expect(requests).toHaveLength(offers.length);
    expect(requests.every((request) => !("submittedCode" in request))).toBe(
      true
    );
  });

  test("carries a submitted discount code on every offer request", () => {
    const submittedCode = canonicalPromotionCodeSchema.make("SUMMER10");
    const requests = getCoworkTierAdvertisedPriceRequests({
      date: "2099-07-30",
      locale: "en-US",
      offers,
      submittedCode,
    });

    expect(requests.map((request) => request.submittedCode)).toEqual([
      submittedCode,
      submittedCode,
    ]);
  });
});
