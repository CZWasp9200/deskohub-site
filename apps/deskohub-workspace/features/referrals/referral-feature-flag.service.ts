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
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;

      return {
        isEnabled: featureFlags.isEnabled("referrals").pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Referral feature flag evaluation unavailable", {
              cause: error.cause,
            })
          ),
          Effect.orElseSucceed(() => false)
        ),
      } satisfies IReferralFeatureFlagService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
