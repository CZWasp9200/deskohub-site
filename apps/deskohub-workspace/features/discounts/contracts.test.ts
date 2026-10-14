import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { discountProductTargetSchema } from "./contracts";

describe("discount contracts", () => {
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
