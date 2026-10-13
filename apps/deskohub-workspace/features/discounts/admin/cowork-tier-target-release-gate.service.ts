import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";

const coworkTierTargetFlag = "cowork_tier_discount_targets";

export interface ICoworkTierTargetReleaseGate {
  /**
   * Whether administrators may add single-tier cowork discount targets. Only a
   * flag value of exactly `true` releases them; reading and pricing stored
   * tier targets never consult this gate.
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
        isReleased: featureFlags
          .evaluateFlags({ flagKeys: [coworkTierTargetFlag] })
          .pipe(
            Effect.flatMap((snapshot) => {
              // A multivariate value such as "control" is enabled in PostHog
              // but does not release the gate.
              const value: boolean | string | undefined =
                snapshot.getFlag(coworkTierTargetFlag);
              return value === undefined
                ? logUnavailableGate("MissingFeatureFlag").pipe(
                    Effect.as(false)
                  )
                : Effect.succeed(value === true);
            }),
            Effect.tapError((error) => logUnavailableGate(error._tag)),
            Effect.orElseSucceed(() => false)
          ),
      } satisfies ICoworkTierTargetReleaseGate;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}

const logUnavailableGate = (errorTag: string) =>
  Effect.logWarning(
    "Cowork tier discount target release gate is unavailable"
  ).pipe(
    Effect.annotateLogs({
      discountBoundary: "release_gate",
      discountFeatureFlag: coworkTierTargetFlag,
      discountErrorTag: errorTag,
    })
  );
