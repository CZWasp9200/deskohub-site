import "server-only";

import { headers } from "next/headers";
import { getAuth } from "@/features/account/backend/auth.server";

export type SessionUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

/** Whether this deployment has the accounts database and secret configured. */
export const areAccountsAvailable = (): boolean => getAuth() !== undefined;

/** The signed-in customer of the current request, or `null`. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = getAuth();
  if (!auth) return null;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const { id, name, email } = session.user;
  return { id, name, email };
}
