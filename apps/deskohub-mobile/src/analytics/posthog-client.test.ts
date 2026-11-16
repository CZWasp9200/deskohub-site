import { describe, expect, test } from "bun:test";
import { postHogConstructions } from "../testing/posthog-stand-in";
import { createPostHogClient } from "./posthog-client";

describe("createPostHogClient", () => {
  test.each([
    [true, false],
    [false, true],
  ])(
    "with remote flags %p, sets disableRemoteFeatureFlags to %p",
    (remoteFeatureFlags, disabled) => {
      postHogConstructions.length = 0;
      createPostHogClient({
        apiKey: "phc_test",
        host: "https://t.example.test",
        remoteFeatureFlags,
        superProperties: {},
      });
      expect(postHogConstructions[0]?.options.disableRemoteFeatureFlags).toBe(
        disabled
      );
    }
  );
});
