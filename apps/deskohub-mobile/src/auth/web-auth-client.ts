import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { magicLinkSessionRefresh } from "./magic-link-session-refresh";

/**
 * The web bundle's Better Auth client against a Workspace origin. It mirrors
 * the site's browser client: magic link, sign-in code and passkeys.
 */
export const createWebAuthClient = (apiOrigin: string) =>
  createAuthClient({
    baseURL: `${apiOrigin}/api/auth`,
    plugins: [
      magicLinkClient(),
      magicLinkSessionRefresh(),
      emailOTPClient(),
      passkeyClient(),
    ],
    fetchOptions: {
      // Better Auth otherwise keeps the `fetch` it sees when the client is
      // created. BotID (`bot-protection.web.ts`) replaces the global `fetch`
      // later, to add its token to the sign-in email and code requests, so
      // each request looks the global up again.
      customFetchImpl: (input, init) => globalThis.fetch(input, init),
    },
  });
