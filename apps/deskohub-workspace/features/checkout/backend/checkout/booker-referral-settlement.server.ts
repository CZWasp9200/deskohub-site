import "server-only";

import { Effect, Layer } from "effect";
import { CustomerAccountContactService } from "@/features/account";
import { ReferralService } from "@/features/referrals";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { isBookerReferralSettled } from "./booker-referral-settlement";

/** `isBookerReferralSettled` for a Server Component page render. */
export const checkBookerReferralSettled = (
  booking: Parameters<typeof isBookerReferralSettled>[0]
) =>
  isBookerReferralSettled(booking).pipe(
    Effect.provide(
      Layer.mergeAll(
        CustomerAccountContactService.Live,
        ReferralService.Live
      ).pipe(Layer.provideMerge(ReferralFeatureFlagRequest))
    ),
    runWorkspaceEffect("checkout.booker-referral-settlement", {
      boundary: "page",
    })
  );
