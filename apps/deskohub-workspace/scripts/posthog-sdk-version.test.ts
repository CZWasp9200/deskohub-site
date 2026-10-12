import { expect, test } from "bun:test";
import {
  capturedOnlyByPinnedSdk,
  expectedPosthogSdkVersion,
  readInstalledPosthogSdkVersion,
} from "./posthog-sdk-version";

// The PostHog identity browser check runs by hand, so this keeps its SDK
// preflight from drifting away from the pinned, installed posthog-js.
test("pins one exact posthog-js version for the identity browser check", () => {
  expect(expectedPosthogSdkVersion).toMatch(/^\d+\.\d+\.\d+$/);
});

test("installs the pinned posthog-js version the identity check bundles", async () => {
  expect(await readInstalledPosthogSdkVersion()).toBe(
    expectedPosthogSdkVersion
  );
});

test("accepts a capture whose every event reports the pinned version", () => {
  expect(
    capturedOnlyByPinnedSdk([
      expectedPosthogSdkVersion,
      expectedPosthogSdkVersion,
    ])
  ).toBe(true);
});

test("rejects a capture with an unversioned event beside a pinned one", () => {
  expect(capturedOnlyByPinnedSdk([expectedPosthogSdkVersion, undefined])).toBe(
    false
  );
});

test("rejects a capture with another SDK version or no events", () => {
  expect(capturedOnlyByPinnedSdk([expectedPosthogSdkVersion, "0.0.0"])).toBe(
    false
  );
  expect(capturedOnlyByPinnedSdk([])).toBe(false);
});
