import { describe, expect, test } from "bun:test";
import { canonicalPromotionCodeSchema } from "@/features/discounts";
import { getCoworkFormAdvertisedPriceRequests } from "./cowork-advertised-price";

describe("getCoworkFormAdvertisedPriceRequests", () => {
  test("leaves the discount code out when none was submitted", () => {
    const requests = getCoworkFormAdvertisedPriceRequests({
      coffee: true,
      date: "2099-07-30",
      locale: "en-US",
    });

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => !("submittedCode" in request))).toBe(
      true
    );
  });

  test("carries a submitted discount code on every offer request", () => {
    const submittedCode = canonicalPromotionCodeSchema.make("SUMMER10");
    const requests = getCoworkFormAdvertisedPriceRequests({
      coffee: true,
      date: "2099-07-30",
      locale: "en-US",
      submittedCode,
    });

    expect(requests.length).toBeGreaterThan(0);
    expect(
      requests.every((request) => request.submittedCode === submittedCode)
    ).toBe(true);
  });
});
