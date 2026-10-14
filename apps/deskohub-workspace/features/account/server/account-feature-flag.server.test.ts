import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Logger } from "effect";
import type { IAccountFeatureFlagService } from "../backend/account-feature-flag.service";
import { AccountFeatureFlagServiceMock } from "../backend/account-feature-flag.service.mock";

mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string) =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
}));

const { accountAvatarsEnabled } = await import("./account-feature-flag.server");

const provideAvatarFlag = (
  isAvatarEnabled: IAccountFeatureFlagService["isAvatarEnabled"]
) =>
  Effect.provide(
    AccountFeatureFlagServiceMock({
      isEnabled: Effect.succeed(false),
      isAvatarEnabled,
    })
  );

describe("account avatar feature flag boundary", () => {
  test("fails closed with a fixed warning when the capability is unavailable", async () => {
    const logRecords: { readonly level: string; readonly message: string }[] =
      [];
    const logger = Logger.make((options) => {
      logRecords.push({
        level: options.logLevel,
        message: options.message.join(""),
      });
    });

    const enabled = await accountAvatarsEnabled.pipe(
      provideAvatarFlag(
        Effect.fail(
          new PostHogFeatureFlagEvaluationError({
            message: "Could not evaluate the PostHog feature flag.",
            cause: new Error("private provider detail"),
          })
        )
      ),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(enabled).toBe(false);
    expect(logRecords).toEqual([
      {
        level: "Warn",
        message: "Account avatar feature flag evaluation unavailable",
      },
    ]);
    expect(JSON.stringify(logRecords)).not.toContain("private provider detail");
  });
});
