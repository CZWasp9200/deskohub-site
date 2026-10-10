import "server-only";

import { Effect, Result } from "effect";
import { connection } from "next/server";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * Whether the current request carries a usable customer session. Any
 * authentication failure reads as signed out; account pages and Server
 * Actions still re-check the authoritative session themselves.
 */
export async function isCustomerSignedIn(operation: string): Promise<boolean> {
  await connection();

  const session = await Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.provide(CustomerAuthentication.Default),
    Effect.result,
    runWorkspaceEffect(operation, { boundary: "page" })
  );

  return Result.isSuccess(session) && session.success !== null;
}
