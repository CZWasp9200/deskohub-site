import { describe, expect, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Layer } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { ReferralFeatureFlagService } from "./referral-feature-flag.service";

const evaluateTwice = (
  isEnabled: () => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>
) => {
  let evaluations = 0;
  const decisions = Effect.runPromise(
    ReferralFeatureFlagService.pipe(
      Effect.flatMap((featureFlag) =>
        Effect.all([featureFlag.isEnabled, featureFlag.isEnabled])
      ),
      Effect.provide(
        ReferralFeatureFlagService.Default.pipe(
          Layer.provide(
            WorkspaceFeatureFlagServiceMock({
              isEnabled: () =>
                Effect.suspend(() => {
                  evaluations += 1;
                  return isEnabled();
                }),
            })
          )
        )
      )
    )
  );
  return decisions.then((values) => ({ evaluations, values }));
};

describe("ReferralFeatureFlagService", () => {
  test("releases the program only for a true flag", async () => {
    expect(await evaluateTwice(() => Effect.succeed(true))).toEqual({
      evaluations: 1,
      values: [true, true],
    });
    expect(await evaluateTwice(() => Effect.succeed(false))).toEqual({
      evaluations: 1,
      values: [false, false],
    });
  });

  test("withholds the program when the flag cannot be evaluated, and keeps that decision", async () => {
    expect(
      await evaluateTwice(() =>
        Effect.fail(
          new PostHogFeatureFlagEvaluationError({
            message: "synthetic flag outage",
            cause: undefined,
          })
        )
      )
    ).toEqual({ evaluations: 1, values: [false, false] });
  });

  test("decides once per build, so a later outage cannot change a decision made", async () => {
    let calls = 0;
    expect(
      await evaluateTwice(() =>
        calls++ === 0
          ? Effect.succeed(true)
          : Effect.fail(
              new PostHogFeatureFlagEvaluationError({
                message: "synthetic flag outage",
                cause: undefined,
              })
            )
      )
    ).toEqual({ evaluations: 1, values: [true, true] });
  });
});
