import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect } from "effect";
import type { IWorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { CoworkTierTargetReleaseGate } from "./cowork-tier-target-release-gate.service";

const evaluateGate = (isEnabled: IWorkspaceFeatureFlagService["isEnabled"]) =>
  Effect.gen(function* () {
    const gate = yield* CoworkTierTargetReleaseGate;
    return yield* gate.isReleased;
  }).pipe(
    Effect.provide(CoworkTierTargetReleaseGate.Default),
    Effect.provide(WorkspaceFeatureFlagServiceMock({ isEnabled })),
    Effect.runPromise
  );

describe("CoworkTierTargetReleaseGate", () => {
  test("reads the cowork tier discount target flag", async () => {
    const keys: string[] = [];

    const released = await evaluateGate((key) =>
      Effect.sync(() => {
        keys.push(key);
        return true;
      })
    );

    expect(released).toBe(true);
    expect(keys).toEqual(["cowork_tier_discount_targets"]);
  });

  test("stays closed when the flag is off", async () => {
    expect(await evaluateGate(() => Effect.succeed(false))).toBe(false);
  });

  test("fails closed when the flag is missing or PostHog is unavailable", async () => {
    const released = await evaluateGate(() =>
      Effect.fail(
        new PostHogFeatureFlagEvaluationError({
          message: "Could not evaluate the PostHog feature flag.",
          cause: undefined,
        })
      )
    );

    expect(released).toBe(false);
  });
});
