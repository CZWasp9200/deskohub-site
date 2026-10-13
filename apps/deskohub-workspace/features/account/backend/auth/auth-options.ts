import type { BetterAuthOptions } from "better-auth";

/**
 * Session windows fixed by the security contract: a 30-day rolling lifetime,
 * an at-most-daily refresh age, and a 10-minute freshness requirement for
 * destructive actions. Cookie caching stays disabled so logout, deletion, and
 * server-side revocation act on the next authoritative request.
 */
const betterAuthSessionOptions = {
  expiresIn: 60 * 60 * 24 * 30,
  updateAge: 60 * 60 * 24,
  freshAge: 60 * 10,
  cookieCache: {
    enabled: false,
  },
  storeSessionInDatabase: true,
} as const;

/**
 * Magic links expire after ten minutes, are consumed atomically on first use,
 * and store only a hash in the verification table. Both magic-link endpoints
 * allow five requests per client IP per ten minutes.
 */
export const betterAuthMagicLinkOptions = {
  expiresIn: 600,
  storeToken: "hashed",
  rateLimit: {
    window: 600,
    max: 5,
  },
} as const;

/**
 * Connectionless Better Auth options shared between schema generation and the
 * runtime instance. The runtime singleton adds the database adapter, dynamic
 * `baseURL`, secrets, plugins, and lifecycle hooks on top of this object.
 */
export const authOptions = {
  appName: "Deskohub Workspace",
  user: {
    additionalFields: {
      deletionRequestedAt: {
        type: "date",
        required: false,
        input: false,
      },
      // The customer's saved locale preference (en-US or cs-CZ, enforced by
      // a CHECK constraint). Null until account creation seeds it or a
      // sign-in captures it; never defaulted. Server-owned, so clients
      // cannot set it.
      locale: {
        type: "string",
        required: false,
        input: false,
      },
    },
    deleteUser: {
      enabled: true,
    },
  },
  session: betterAuthSessionOptions,
  verification: {
    storeIdentifier: "hashed",
  },
  emailAndPassword: {
    enabled: false,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      sameSite: "lax",
      path: "/",
    },
    ipAddress: {
      ipAddressHeaders: ["x-vercel-forwarded-for"],
    },
    disableCSRFCheck: false,
    disableOriginCheck: false,
    trustedProxyHeaders: false,
    // Session reads load the user in the same query, so a signed-in
    // request resolves its session, account, and locale preference in one
    // lookup.
    database: {
      joins: true,
    },
  },
} satisfies BetterAuthOptions;
