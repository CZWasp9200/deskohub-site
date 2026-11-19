"use server";

import { APIError } from "better-auth";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/features/account/backend/auth.server";
import { safeReturnPath } from "@/features/account/sign-in-path";
import { actionClient } from "@/shared/utils/safe-action-client";

const deleteAccountSchema = z.object({
  // The customer ticked that they understand what gets deleted.
  confirmed: z.literal(true),
  // The localized account page a fresh sign-in link returns to.
  returnPath: z.string(),
});

type DeleteAccountResult =
  | { readonly status: "deleted" }
  | { readonly status: "signInLinkSent" }
  | { readonly status: "failed" };

/**
 * Deletes the signed-in customer's account through Better Auth: the user
 * with its sessions and sign-in accounts, and the session cookies. The
 * database cascades memberships, event registrations and trophies. Sign-in
 * links aren't tied to the user; they expire and the daily cleanup removes
 * them.
 *
 * Better Auth only deletes from a session signed in within the last day
 * (`session.freshAge`). An older session gets a fresh sign-in link back to
 * the account page instead.
 */
const _deleteAccount = actionClient
  .inputSchema(deleteAccountSchema)
  .action(async ({ parsedInput }): Promise<DeleteAccountResult> => {
    const auth = getAuth();
    const requestHeaders = await headers();
    const session = await auth?.api.getSession({ headers: requestHeaders });
    if (!(auth && session)) return { status: "failed" };

    try {
      await auth.api.deleteUser({ body: {}, headers: requestHeaders });
      return { status: "deleted" };
    } catch (error) {
      const sessionTooOld =
        error instanceof APIError && error.body?.code === "SESSION_EXPIRED";
      if (!sessionTooOld) throw error;
    }

    await auth.api.signInMagicLink({
      body: {
        email: session.user.email,
        callbackURL: safeReturnPath(parsedInput.returnPath),
      },
      headers: requestHeaders,
    });
    return { status: "signInLinkSent" };
  });

// Next.js only registers explicitly async exports as Server Actions, so
// each safe action is re-exported through a thin async wrapper.
export const deleteAccount = async (
  ...args: Parameters<typeof _deleteAccount>
) => {
  "use server";
  return await _deleteAccount(...args);
};
