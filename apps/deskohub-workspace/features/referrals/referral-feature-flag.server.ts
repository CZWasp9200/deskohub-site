import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { ReferralFeatureFlagService } from "./referral-feature-flag.service";

/** Memoized per request: layouts, pages, and loaders of one render share it. */
export const areReferralsEnabled = cache(
  async (): Promise<boolean> =>
    ReferralFeatureFlagService.pipe(
      Effect.flatMap((featureFlag) => featureFlag.isEnabled),
      Effect.provide(ReferralFeatureFlagService.Live),
      runWorkspaceEffect("referrals.enabled")
    )
);
