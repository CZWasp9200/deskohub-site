"use server";

import { z } from "zod";
import { getSessionUser } from "@/features/account/server/session.server";
import {
  cancelMembershipRequest,
  type MembershipRequestOutcome,
  requestMembership,
} from "@/features/membership/backend/membership.server";
import { actionClient } from "@/shared/utils/safe-action-client";

const planSchema = z.object({ planId: z.number().int().positive() });

export type RequestActionOutcome = MembershipRequestOutcome | "signedOut";

/** Records the signed-in customer's request for a membership plan. */
const _requestMembershipAction = actionClient
  .inputSchema(planSchema)
  .action(async ({ parsedInput }) => {
    const user = await getSessionUser();
    const outcome: RequestActionOutcome = user
      ? await requestMembership(user.id, parsedInput.planId)
      : "signedOut";
    return { outcome };
  });

/** Withdraws the signed-in customer's request that waits for payment. */
const _cancelMembershipRequestAction = actionClient.action(async () => {
  const user = await getSessionUser();
  if (!user) return { outcome: "signedOut" as const };

  await cancelMembershipRequest(user.id);
  return { outcome: "cancelled" as const };
});

// Next.js only registers explicitly async exports as Server Actions, so
// each safe action is re-exported through a thin async wrapper.
export const requestMembershipAction = async (
  ...args: Parameters<typeof _requestMembershipAction>
) => {
  "use server";
  return await _requestMembershipAction(...args);
};

export const cancelMembershipRequestAction = async (
  ...args: Parameters<typeof _cancelMembershipRequestAction>
) => {
  "use server";
  return await _cancelMembershipRequestAction(...args);
};
