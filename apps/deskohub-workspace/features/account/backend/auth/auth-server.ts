import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { getLocaleFromPathname } from "@deskohub/i18n/pathname";
import { APIError, type BetterAuthOptions, betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { Effect, Option, Schema } from "effect";
import { after } from "next/server";
import { makeAuthDatabase } from "@/db/auth-database-client";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceDatabasePool } from "@/db/database-provider.server";
import { drizzleAuthTables } from "@/db/schema/auth";
import { env } from "@/env";
import { CustomerAccountDeletionService } from "@/features/account/backend/customer-account-deletion";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { defaultLocale, isLocale, type Locale, locales } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  lookupMagicLinkDeliveryLocale,
  type MagicLinkLocaleLookup,
} from "../customer-communication-preference.repository";
import { authOptions, betterAuthMagicLinkOptions } from "./auth-options";
import { renderMagicLinkEmail } from "./magic-link-email";
import { makeMagicLinkEmailDelivery } from "./send-magic-link-email";

export type MagicLinkSendFunction = NonNullable<
  Parameters<typeof magicLink>[0]["sendMagicLink"]
>;

export type WorkspaceAuthConfig = {
  readonly database: NonNullable<BetterAuthOptions["database"]>;
  readonly secrets: NonNullable<BetterAuthOptions["secrets"]>;
  readonly allowedHosts: readonly string[];
  readonly httpsOnly: boolean;
  readonly areAccountsEnabled: () => Promise<boolean>;
  readonly sendMagicLink: MagicLinkSendFunction;
  readonly beforeDeleteUser: (accountId: CustomerAccountId) => Promise<void>;
  /**
   * Inserts the preferred communication language only when the account has
   * none, never overwriting a saved preference. Account creation seeds it
   * from the initiating site locale, retrying and rejecting the hook on a
   * persistent failure. Every sign-in captures it from the callback locale
   * for accounts that predate the preference, and a capture failure never
   * blocks the login.
   */
  readonly createAccountCommunicationPreference: (
    accountId: CustomerAccountId,
    locale: Locale
  ) => Promise<void>;
};

/**
 * Retries the preference seed with the same initiating locale so a transient
 * failure still produces the row. A persistent failure is returned so the
 * activating request reports failure.
 */
const seedCommunicationPreferenceOrFail = async (
  config: WorkspaceAuthConfig,
  accountId: CustomerAccountId,
  locale: Locale
): Promise<{ readonly error: unknown } | undefined> => {
  let lastError: unknown = new Error(
    "The communication preference seed did not run."
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await config.createAccountCommunicationPreference(accountId, locale);
      return undefined;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  await runWorkspaceEffect("account.magic-link.seed-locale", {
    boundary: "route",
  })(
    Effect.logWarning(
      "Customer communication preference seed failed; rejecting account activation.",
      { code: "account-communication-preference.seed-failed" }
    )
  ).catch(() => undefined);
  return { error: lastError };
};

const accountMagicLinkPaths = new Set([
  "/sign-in/magic-link",
  "/magic-link/verify",
]);
const accountsUnavailableErrors = new WeakSet<object>();

const makeAccountsUnavailableError = () => {
  const error = new APIError("SERVICE_UNAVAILABLE", {
    message: "Service Unavailable",
  });
  accountsUnavailableErrors.add(error);
  return error;
};

const isAccountsUnavailableError = (error: APIError) =>
  accountsUnavailableErrors.has(error);

const magicLinkMetadataSchema = Schema.Struct({
  locale: Schema.optional(Schema.String),
});

const decodeMagicLinkLocale = (
  data: Parameters<MagicLinkSendFunction>[0]
): Locale => {
  const decoded = Option.getOrUndefined(
    Schema.decodeOption(magicLinkMetadataSchema)(data.metadata ?? {})
  );
  const locale = decoded?.locale;
  return locale && isLocale(locale) ? locale : defaultLocale;
};

const authContextSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  query: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

type ParsedAuthContext = {
  readonly path?: string;
  readonly query?: Readonly<Record<string, string>>;
};

/**
 * Reads the site language from the auth request's localized callback URL:
 * the magic-link verify request carries it. Returns nothing when the
 * callback is absent, unparseable, or carries no locale.
 */
const callbackLocaleFromAuthContext = (
  ctx: ParsedAuthContext
): Locale | undefined => {
  const callbackURL = ctx.query?.callbackURL ?? ctx.path;
  if (!callbackURL) return undefined;
  try {
    return getLocaleFromPathname(
      new URL(callbackURL, "https://auth.internal.invalid").pathname,
      locales
    );
  } catch {
    return undefined;
  }
};

/**
 * Captures the sign-in callback locale as the preference of an account that
 * has none, such as one created before preferences existed. The insert never
 * overwrites a saved preference. A failure is logged with a fixed code and
 * never blocks the login: readers fall back without a preference, and the
 * next sign-in retries.
 */
const captureCommunicationPreference = async (
  config: WorkspaceAuthConfig,
  accountId: CustomerAccountId,
  ctx: ParsedAuthContext
) => {
  const locale = callbackLocaleFromAuthContext(ctx);
  if (!locale) return;
  try {
    await config.createAccountCommunicationPreference(accountId, locale);
  } catch {
    await runWorkspaceEffect("account.auth.capture-locale", {
      boundary: "route",
    })(
      Effect.logWarning(
        "Customer communication preference capture failed; continuing the sign-in.",
        { code: "account-communication-preference.capture-failed" }
      )
    ).catch(() => undefined);
  }
};

/**
 * Picks the magic-link email language. A verified existing account uses its
 * saved preference. An account without a preference, a pre-account (first)
 * delivery, and a pending unverified signup use the initiating site locale.
 * An unreadable preference skips delivery so no wrong-language magic link
 * reaches a customer.
 */
type MagicLinkDeliveryDecision =
  | { readonly action: "deliver"; readonly locale: Locale }
  | {
      readonly action: "skip";
      readonly code: "account.magic-link.locale.read-failed";
    };

const decideMagicLinkDelivery = (
  lookup: MagicLinkLocaleLookup,
  fallback: Locale
): MagicLinkDeliveryDecision => {
  if (lookup.kind === "account")
    return { action: "deliver", locale: lookup.locale };
  if (lookup.kind === "read-failed") {
    return { action: "skip", code: "account.magic-link.locale.read-failed" };
  }
  return { action: "deliver", locale: fallback };
};

/**
 * Builds the Workspace Better Auth instance on top of the shared
 * connectionless options. The database adapter, secrets, dynamic host
 * allowlist, and lifecycle callbacks are the only runtime additions.
 */
export const makeWorkspaceAuth = (config: WorkspaceAuthConfig) => {
  const baseURL = { allowedHosts: [...config.allowedHosts] };
  if (config.httpsOnly) Object.assign(baseURL, { protocol: "https" as const });

  return betterAuth({
    ...authOptions,
    secrets: config.secrets,
    baseURL,
    database: config.database,
    logger: { disabled: true },
    onAPIError: {
      onError: (error) => {
        if (
          isAPIError(error) &&
          (error.statusCode < 500 || isAccountsUnavailableError(error))
        ) {
          return;
        }

        void runWorkspaceEffect("account.auth.handler", { boundary: "route" })(
          Effect.logError("Better Auth request failed.", {
            code: "account.auth.handler",
          })
        ).catch(() => undefined);

        // Keep better-call from falling through to its raw error logger.
        // biome-ignore lint: This synchronous third-party callback must return a fixed APIError.
        throw new APIError("INTERNAL_SERVER_ERROR", {
          message: "Internal Server Error",
        });
      },
    },
    disabledPaths: ["/update-user"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (accountMagicLinkPaths.has(ctx.path)) {
          let enabled = false;
          try {
            enabled = await config.areAccountsEnabled();
          } catch {
            enabled = false;
          }
          if (!enabled) return Promise.reject(makeAccountsUnavailableError());
        }

        const hasProfileFields =
          ctx.path === "/sign-in/magic-link" &&
          (Object.hasOwn(ctx.body, "name") || Object.hasOwn(ctx.body, "image"));

        if (ctx.path === "/update-user" || hasProfileFields) {
          return Promise.reject(
            new APIError("BAD_REQUEST", {
              message: "Profile fields are not accepted.",
            })
          );
        }
      }),
    },
    plugins: [
      magicLink({
        ...betterAuthMagicLinkOptions,
        sendMagicLink: config.sendMagicLink,
      }),
      // Better Auth requires `nextCookies` to be the last plugin: it forwards
      // Set-Cookie headers into the Next.js cookie store for Server Action
      // `auth.api` calls and defers RSC-only session refreshes.
      nextCookies(),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            const accountId = Option.getOrUndefined(
              Schema.decodeOption(customerAccountIdSchema)(session.userId)
            );
            if (accountId) {
              // The auth request context is the I/O boundary: parse it here.
              const parsedCtx = Option.getOrUndefined(
                Schema.decodeUnknownOption(authContextSchema)(ctx)
              );
              await captureCommunicationPreference(
                config,
                accountId,
                parsedCtx ?? {}
              );
            }
            return {
              data: {
                ...session,
                ipAddress: null,
                userAgent: null,
              },
            };
          },
        },
      },
      user: {
        create: {
          after: async (user, ctx) => {
            const accountId = Option.getOrUndefined(
              Schema.decodeOption(customerAccountIdSchema)(user.id)
            );
            if (!accountId) return;
            // The auth request context is the I/O boundary: parse it here.
            const parsedCtx = Option.getOrUndefined(
              Schema.decodeUnknownOption(authContextSchema)(ctx)
            );
            // Anything without a callback locale seeds the site default.
            const locale =
              callbackLocaleFromAuthContext(parsedCtx ?? {}) ?? defaultLocale;
            const seedFailure = await seedCommunicationPreferenceOrFail(
              config,
              accountId,
              locale
            );
            if (seedFailure) {
              // The user row is already committed when this hook runs, but
              // the preference row is missing, so the activation request
              // must not report success. A later sign-in captures the
              // preference from its own callback locale.
              return Promise.reject(
                seedFailure.error instanceof Error
                  ? seedFailure.error
                  : new Error(
                      "The customer communication preference seed failed."
                    )
              );
            }
          },
        },
      },
    },
    user: {
      ...authOptions.user,
      deleteUser: {
        ...authOptions.user?.deleteUser,
        enabled: true,
        beforeDelete: (user) => {
          const accountId = Option.getOrUndefined(
            Schema.decodeOption(customerAccountIdSchema)(user.id)
          );
          if (!accountId) {
            return Promise.reject(
              new Error(
                "The deleting session carried an invalid account identifier."
              )
            );
          }
          return config.beforeDeleteUser(accountId);
        },
      },
    },
  });
};

const makeWorkspaceMagicLinkDelivery = () =>
  makeMagicLinkEmailDelivery(renderMagicLinkEmail, {
    isVercelPreview: env.VERCEL_ENV === "preview",
  });

export const makeWorkspaceAuthDatabase = () =>
  drizzleAdapter(makeAuthDatabase(workspaceDatabasePool), {
    provider: "pg",
    schema: drizzleAuthTables,
    schemaName: "auth",
  });

export const workspaceSendMagicLink: MagicLinkSendFunction = async (data) => {
  const fallbackLocale = decodeMagicLinkLocale(data);
  const lookup = await runWorkspaceEffect("account.magic-link.locale", {
    boundary: "route",
  })(
    lookupMagicLinkDeliveryLocale(data.email).pipe(
      Effect.provide(WorkspaceDatabase.Default)
    )
  ).catch(() => ({ kind: "read-failed" }) as const);
  const decision = decideMagicLinkDelivery(lookup, fallbackLocale);
  if (decision.action === "skip") {
    await runWorkspaceEffect("account.magic-link.locale", {
      boundary: "route",
    })(
      Effect.logWarning(
        "Magic-link delivery skipped for an existing account with an unreadable language preference.",
        { code: decision.code }
      )
    ).catch(() => undefined);
    return;
  }
  const locale = decision.locale;
  after(() =>
    runWorkspaceEffect("account.magic-link.deliver", { boundary: "task" })(
      makeWorkspaceMagicLinkDelivery().deliver({
        email: data.email,
        url: data.url,
        locale,
      })
    )
  );
};

export const workspaceBeforeDeleteUser = (accountId: CustomerAccountId) =>
  runWorkspaceEffect("account.deletion.provider-expiration", {
    boundary: "task",
  })(
    Effect.flatMap(CustomerAccountDeletionService, (service) =>
      service.requestDeletion(accountId)
    ).pipe(Effect.provide(CustomerAccountDeletionService.Live))
  );
