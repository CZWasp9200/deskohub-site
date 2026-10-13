"use server";

import { Effect } from "effect";
import { checkoutSubmitDeadline } from "@/features/checkout/backend/checkout";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { submitReservationEffect } from "@/features/reservation/actions/submit-reservation-composition";
import { submitReservationSchema } from "@/features/reservation/actions/submit-reservation-input";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const submitReservationAction = defineWorkspaceAction(
  {
    operation: "checkout.submit-reservation",
    deadline: checkoutSubmitDeadline,
    schema: submitReservationSchema,
  },
  (input) =>
    submitReservationEffect(input).pipe(
      Effect.provide(ReferralFeatureFlagRequest)
    )
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
