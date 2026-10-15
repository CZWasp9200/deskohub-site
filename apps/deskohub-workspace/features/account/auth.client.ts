"use client";

import { createAuthClient } from "better-auth/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";

/**
 * The same-origin Better Auth browser client. It only performs magic-link
 * and sign-in code requests, session refreshes, and current-device sign-outs; every page and
 * Server Action re-reads the authoritative server session.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), emailOTPClient()],
});
