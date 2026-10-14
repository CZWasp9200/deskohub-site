import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

export interface IReferralFeatureFlagService {
  /**
   * Whether the referral program is released. A flag that cannot be
   * evaluated, including a missing one, counts as off.
   */
  readonly isEnabled: Effect.Effect<boolean>;
}

export class ReferralFeatureFlagService extends Context.Service<
  ReferralFeatureFlagService,
  IReferralFeatureFlagService
>()("@deskohub-workspace/referrals/ReferralFeatureFlagService") {
  /**
   * Evaluates the flag at most once per build of this layer, so one run sees
   * one decision. Next.js request code instead provides the per-request page
   * gate (`ReferralFeatureFlagRequest` in `referral-feature-flag.server.ts`).
   * Never put this in a process-wide runtime layer.
   */
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;
      const isEnabled = yield* Effect.cached(
        featureFlags.isEnabled("referrals").pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Referral feature flag evaluation unavailable", {
              cause: error.cause,
            })
          ),
          Effect.orElseSucceed(() => false)
        )
      );

      return { isEnabled } satisfies IReferralFeatureFlagService;
    })
  );

  /** A decision the caller already made for this request. */
  static fromDecision = (enabled: boolean) =>
    Layer.succeed(this, { isEnabled: Effect.succeed(enabled) });

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
