import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { EmailServiceTag } from "@deskohub/email";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { Effect } from "effect";
import { z } from "zod";
import { getAccountsDatabase } from "@/db/database.server";
import { authTables } from "@/db/schema";
import { env } from "@/env";
import { locales } from "@/features/i18n";
import { BoardgameEmailLayer } from "@/shared/backend/config/email.config";
import { isDev } from "@/shared/utils/environment";
import { resolveAuthAllowedHosts } from "./auth-hosts";
import { buildSignInEmail, callbackLocale } from "./sign-in-email";

const SIGN_IN_LINK_LIFETIME_SECONDS = 600;

const DISPLAY_NAME_MAX_LENGTH = 40;

/**
 * The name of an account created by signing in without registering first:
 * the part of the email before the "@". Registration supplies a nickname.
 */
const defaultDisplayName = (email: string): string =>
  email.split("@")[0]?.slice(0, DISPLAY_NAME_MAX_LENGTH) || email;

const sendSignInEmail = (email: string, url: string): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const emailService = yield* EmailServiceTag;
      yield* emailService.send(
        buildSignInEmail({
          email,
          url,
          expiresInMinutes: SIGN_IN_LINK_LIFETIME_SECONDS / 60,
        })
      );
    }).pipe(
      Effect.tapError((error) =>
        Effect.logError("Failed to send the sign-in email", { error })
      ),
      Effect.asVoid,
      Effect.provide(BoardgameEmailLayer)
    )
  );

function makeAuth(
  database: NonNullable<ReturnType<typeof getAccountsDatabase>>,
  secret: string
) {
  const development = isDev({
    nodeEnv: env.NEXT_PUBLIC_NODE_ENV,
    vercelEnv: env.NEXT_PUBLIC_VERCEL_ENV,
    // Never trust the request host here; only the build-time environment.
    hostname: "",
  });

  return betterAuth({
    appName: "Deskohub Boardgame Bar",
    secret,
    baseURL: {
      allowedHosts: resolveAuthAllowedHosts({
        projectProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
        deploymentUrl: env.NEXT_PUBLIC_VERCEL_URL,
        branchUrl: process.env.VERCEL_BRANCH_URL,
        development,
        developmentPort: process.env.PORT,
      }),
      ...(development ? {} : { protocol: "https" as const }),
    },
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: authTables,
    }),
    // Sign-in is by emailed link only; there are no passwords to leak.
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        // The language switcher saves it through authClient.updateUser.
        locale: {
          type: "string",
          required: false,
          validator: { input: z.enum(locales) },
        },
      },
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Read the session from the database every time so sign-out and
      // deletion take effect on the next request.
      cookieCache: { enabled: false },
    },
    verification: { storeIdentifier: "hashed" },
    // In-memory counters don't hold across serverless instances.
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      defaultCookieAttributes: { sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for"] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => ({
            data: {
              ...user,
              name:
                user.name?.trim().slice(0, DISPLAY_NAME_MAX_LENGTH) ||
                defaultDisplayName(user.email),
              // The language of the page the first sign-in link returns to.
              locale: callbackLocale(context?.query?.callbackURL ?? ""),
            },
          }),
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: SIGN_IN_LINK_LIFETIME_SECONDS,
        storeToken: "hashed",
        // Each request sends an email, so keep it to five per IP per window.
        rateLimit: { window: SIGN_IN_LINK_LIFETIME_SECONDS, max: 5 },
        sendMagicLink: ({ email, url }) => sendSignInEmail(email, url),
      }),
      // Writes the cookies of auth.api calls made in Server Actions, such as
      // the expired session cookies after deleting the account. Keep it last.
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof makeAuth>;

const globalStore = globalThis as typeof globalThis & { boardgameAuth?: Auth };

/**
 * The Better Auth instance, or `undefined` when this deployment has no
 * accounts database or auth secret configured.
 */
export function getAuth(): Auth | undefined {
  const database = getAccountsDatabase();
  if (!database || !env.BETTER_AUTH_SECRET) return undefined;

  globalStore.boardgameAuth ??= makeAuth(database, env.BETTER_AUTH_SECRET);
  return globalStore.boardgameAuth;
}
