import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";

export interface ICoworkTierTargetReleaseGate {
  /**
   * Whether administrators may add single-tier cowork discount targets. Off
   * unless the flag evaluates to `true`; reading and pricing stored tier
   * targets never consult this gate.
   */
  readonly isReleased: Effect.Effect<boolean>;
}

export class CoworkTierTargetReleaseGate extends Context.Service<
  CoworkTierTargetReleaseGate,
  ICoworkTierTargetReleaseGate
>()("@deskohub-workspace/discounts/CoworkTierTargetReleaseGate") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;

      return {
        isReleased: featureFlags.isEnabled("cowork_tier_discount_targets").pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              "Cowork tier discount target release gate is unavailable",
              { cause: error.cause }
            ).pipe(
              Effect.annotateLogs({
                discountBoundary: "release_gate",
                discountFeatureFlag: "cowork_tier_discount_targets",
                discountErrorTag: error._tag,
              })
            )
          ),
          Effect.orElseSucceed(() => false)
        ),
      } satisfies ICoworkTierTargetReleaseGate;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
