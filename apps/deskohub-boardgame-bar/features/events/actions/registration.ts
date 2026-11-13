"use server";

import { z } from "zod";
import { getSessionUser } from "@/features/account/server/session.server";
import {
  cancelEventRegistration,
  type RegistrationOutcome,
  registerForEvent,
} from "@/features/events/backend/events.server";
import { actionClient } from "@/shared/utils/safe-action-client";

const eventSchema = z.object({ eventId: z.number().int().positive() });

export type RegisterActionOutcome = RegistrationOutcome | "signedOut";

/** Registers the signed-in customer for an event. */
const _registerForEventAction = actionClient
  .inputSchema(eventSchema)
  .action(async ({ parsedInput }) => {
    const user = await getSessionUser();
    const outcome: RegisterActionOutcome = user
      ? await registerForEvent(parsedInput.eventId, user.id)
      : "signedOut";
    return { outcome };
  });

/** Removes the signed-in customer's registration for an event. */
const _cancelEventRegistrationAction = actionClient
  .inputSchema(eventSchema)
  .action(async ({ parsedInput }) => {
    const user = await getSessionUser();
    if (!user) return { outcome: "signedOut" as const };

    await cancelEventRegistration(parsedInput.eventId, user.id);
    return { outcome: "cancelled" as const };
  });

// Next.js only registers explicitly async exports as Server Actions, so
// each safe action is re-exported through a thin async wrapper.
export const registerForEventAction = async (
  ...args: Parameters<typeof _registerForEventAction>
) => {
  "use server";
  return await _registerForEventAction(...args);
};

export const cancelEventRegistrationAction = async (
  ...args: Parameters<typeof _cancelEventRegistrationAction>
) => {
  "use server";
  return await _cancelEventRegistrationAction(...args);
};
