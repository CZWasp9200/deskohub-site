import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

mock.module("server-only", () => ({}));

const { getLegalAcceptanceSnapshot } = await import("./acceptance-snapshot");

describe("getLegalAcceptanceSnapshot", () => {
  test("hashes each accepted document separately", async () => {
    const snapshot = await Effect.runPromise(
      getLegalAcceptanceSnapshot("en-US")
    );

    const hashes = [
      snapshot.termsAndConditions.hash,
      snapshot.operatingRules.hash,
      snapshot.privacyPolicy.hash,
      snapshot.marketingCommunications.hash,
    ];

    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
