import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import { discountIdSchema, discountProductTargetSchema } from "./contracts";

describe("discount contracts", () => {
  test("brands non-empty opaque discount IDs", () => {
    const decodeDiscountId = Schema.decodeUnknownSync(discountIdSchema);

    expect(decodeDiscountId("opaque-discount-id")).toBe("opaque-discount-id");
    expect(() => decodeDiscountId("")).toThrow();
  });

  test("decodes exactly one target for each reservation family", () => {
    const products = [
      { kind: "cowork" },
      { kind: "meeting-room" },
      { kind: "office" },
    ] as const;

    expect(
      products.map((product) =>
        decodeStandardSchema(discountProductTargetSchema, product)
      )
    ).toEqual(products);
  });

  test("keeps family targets separate from exact product identities", () => {
    for (const product of [
      { kind: "cowork", tier: "basic" },
      {
        kind: "meeting-room",
        duration: { unit: "hour", amount: 1 },
      },
      { kind: "office", seats: 3, dayCount: 2 },
    ]) {
      expect(
        decodeStandardSchema(discountProductTargetSchema, product)
      ).toBeUndefined();
    }
  });

  test("strictly rejects unknown product kinds and fields", () => {
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "event",
        tier: "basic",
      })
    ).toBeUndefined();
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "meeting-room",
        duration: { unit: "hour", amount: 2 },
      })
    ).toBeUndefined();
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "cowork",
        tier: "enterprise",
      })
    ).toBeUndefined();
    expect(
      decodeStandardSchema(discountProductTargetSchema, {
        kind: "cowork",
        tier: "basic",
        roomId: "private-provider-field",
      })
    ).toBeUndefined();
  });
});
