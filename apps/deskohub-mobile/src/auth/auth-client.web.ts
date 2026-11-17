import { resolveApiOrigin } from "./api-origin";
import { createWebAuthClient } from "./web-auth-client";

export const apiOrigin = resolveApiOrigin(
  process.env.EXPO_PUBLIC_API_ORIGIN,
  globalThis.location?.origin
);

/**
 * The web bundle's Better Auth client, served under `/app/` by the Workspace
 * itself, so the session is the site's own same-origin cookie.
 */
export const authClient = createWebAuthClient(apiOrigin);
