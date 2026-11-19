"use client";

import { createAuthClient } from "better-auth/client";
import {
  inferAdditionalFields,
  magicLinkClient,
} from "better-auth/client/plugins";

/**
 * The same-origin Better Auth browser client. It requests sign-in links,
 * signs out and saves the language the customer switches to; pages and
 * Server Actions read the session on the server.
 */
export const authClient = createAuthClient({
  plugins: [
    magicLinkClient(),
    inferAdditionalFields({
      user: { locale: { type: "string", required: false } },
    }),
  ],
});
