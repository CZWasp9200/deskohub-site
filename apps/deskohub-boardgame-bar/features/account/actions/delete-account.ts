"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { getAccountsDatabase } from "@/db/database.server";
import { authUser } from "@/db/schema";
import { getAuth } from "@/features/account/backend/auth.server";
import { actionClient } from "@/shared/utils/safe-action-client";

const deleteAccountSchema = z.object({
  // The customer ticked that they understand what gets deleted.
  confirmed: z.literal(true),
});

/** Better Auth's cookies, with or without the `__Secure-` prefix. */
const isAuthCookie = (name: string) =>
  name.replace(/^__Secure-/, "").startsWith("better-auth.");

/**
 * Deletes the signed-in customer's account. The database deletes everything
 * tied to the account with it (sessions, sign-in links, memberships, event
 * registrations and trophies), and the browser's sign-in cookies are cleared.
 */
const _deleteAccount = actionClient
  .inputSchema(deleteAccountSchema)
  .action(async () => {
    const auth = getAuth();
    const database = getAccountsDatabase();
    const session = await auth?.api.getSession({ headers: await headers() });
    if (!(auth && database && session)) return { deleted: false };

    await database.delete(authUser).where(eq(authUser.id, session.user.id));

    const cookieStore = await cookies();
    for (const cookie of cookieStore.getAll()) {
      if (isAuthCookie(cookie.name)) cookieStore.delete(cookie.name);
    }
    return { deleted: true };
  });

// Next.js only registers explicitly async exports as Server Actions, so
// each safe action is re-exported through a thin async wrapper.
export const deleteAccount = async (
  ...args: Parameters<typeof _deleteAccount>
) => {
  "use server";
  return await _deleteAccount(...args);
};
