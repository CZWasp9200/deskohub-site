import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect } from "effect";
import type { IWorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { CoworkTierTargetReleaseGate } from "./cowork-tier-target-release-gate.service";

const evaluateGate = (
  evaluateFlags: IWorkspaceFeatureFlagService["evaluateFlags"]
) =>
  Effect.gen(function* () {
    const gate = yield* CoworkTierTargetReleaseGate;
    return yield* gate.isReleased;
  }).pipe(
    Effect.provide(CoworkTierTargetReleaseGate.Default),
    Effect.provide(WorkspaceFeatureFlagServiceMock({ evaluateFlags })),
    Effect.runPromise
  );

// PostHog reports a variant string for an enabled multivariate flag, whatever
// value type the generated contract declares.
const evaluatingTo = (value: boolean | string | undefined) => () =>
  Effect.succeed({ getFlag: () => value as never });

describe("CoworkTierTargetReleaseGate", () => {
  test("reads only the cowork tier discount target flag", async () => {
    const requested: unknown[] = [];

    const released = await evaluateGate((options) =>
      Effect.sync(() => {
        requested.push(options?.flagKeys);
        return { getFlag: () => true };
      })
    );

    expect(released).toBe(true);
    expect(requested).toEqual([["cowork_tier_discount_targets"]]);
  });

  test("stays closed when the flag is off", async () => {
    expect(await evaluateGate(evaluatingTo(false))).toBe(false);
  });

  test("stays closed for an enabled multivariate value", async () => {
    expect(await evaluateGate(evaluatingTo("control"))).toBe(false);
  });

  test("fails closed when PostHog did not evaluate the flag", async () => {
    expect(await evaluateGate(evaluatingTo(undefined))).toBe(false);
  });

  test("fails closed when PostHog is unavailable", async () => {
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
