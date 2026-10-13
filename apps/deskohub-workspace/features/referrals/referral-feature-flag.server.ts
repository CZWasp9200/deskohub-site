import "server-only";

import { Effect, Layer } from "effect";
import { cache } from "react";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";
import { ReferralFeatureFlagService } from "./referral-feature-flag.service";

/**
 * Memoized per request: layouts, pages, and loaders of one render share it.
 * Any failure, including a defect or a runtime that cannot start, counts as
 * off.
 */
export const areReferralsEnabled = cache(
  async (): Promise<boolean> =>
    ReferralFeatureFlagService.pipe(
      Effect.flatMap((featureFlag) => featureFlag.isEnabled),
      Effect.provide(ReferralFeatureFlagService.Live),
      runWorkspaceEffectOrElse("referrals.enabled", {
        failureCode: "referral_feature_flag_unavailable",
        orElse: () => false,
      })
    )
);

/**
 * The request's memoized decision for Effect consumers, so services and the
 * page or action that gated them agree for the whole request.
 */
export const ReferralFeatureFlagRequest = Layer.unwrap(
  Effect.promise(areReferralsEnabled).pipe(
    Effect.map(ReferralFeatureFlagService.fromDecision)
  )
);
