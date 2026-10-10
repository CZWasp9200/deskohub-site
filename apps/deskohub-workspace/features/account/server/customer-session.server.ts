import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * Whether the current request carries a usable customer session. Anonymous
 * visitors resolve to no session, and any authentication failure also reads as
 * signed out; account pages and Server Actions still re-check the
 * authoritative session themselves.
 */
export async function isCustomerSignedIn(operation: string): Promise<boolean> {
  await connection();

  return Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.map((session) => session !== null),
    Effect.orElseSucceed(() => false),
    Effect.provide(CustomerAuthentication.Default),
    runWorkspaceEffect(operation, { boundary: "page" })
  );
}
