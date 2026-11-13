"use client";

import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";

/**
 * The same-origin Better Auth browser client. It only requests sign-in links
 * and signs out; pages and Server Actions read the session on the server.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});
