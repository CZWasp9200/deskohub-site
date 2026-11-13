"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/features/account/backend/auth.server";
import { actionClient } from "@/shared/utils/safe-action-client";

const displayNameSchema = z.object({
  name: z.string().trim().min(2).max(40),
});

/** Changes the signed-in customer's display name. */
const _updateDisplayName = actionClient
  .inputSchema(displayNameSchema)
  .action(async ({ parsedInput }) => {
    const auth = getAuth();
    const requestHeaders = await headers();
    const session = await auth?.api.getSession({ headers: requestHeaders });
    if (!auth || !session) return { saved: false };

    await auth.api.updateUser({
      body: { name: parsedInput.name },
      headers: requestHeaders,
    });
    return { saved: true };
  });

// Next.js only registers explicitly async exports as Server Actions, so
// each safe action is re-exported through a thin async wrapper.
export const updateDisplayName = async (
  ...args: Parameters<typeof _updateDisplayName>
) => {
  "use server";
  return await _updateDisplayName(...args);
};
