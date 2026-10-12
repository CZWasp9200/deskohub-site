import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { getLocaleFromPathname } from "@deskohub/i18n/pathname";
import { APIError, type BetterAuthOptions, betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Data, Effect, Match, Option, Predicate, Schema } from "effect";
import { after } from "next/server";
import { makeAuthDatabase } from "@/db/auth-database-client";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceDatabasePool } from "@/db/database-provider.server";
import { retryDatabaseRead } from "@/db/retry-database-read";
import { drizzleAuthTables } from "@/db/schema/auth";
import { env } from "@/env";
import { CustomerAccountDeletionService } from "@/features/account/backend/customer-account-deletion";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { defaultLocale, type Locale, locales } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  lookupMagicLinkDeliveryLocale,
  type MagicLinkLocaleLookup,
} from "../customer-locale-preference.repository";
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
  /** Request-memoized feature-flag read; a rejection counts as disabled. */
  readonly areAccountsEnabled: () => Promise<boolean>;
  readonly sendMagicLink: MagicLinkSendFunction;
  readonly beforeDeleteUser: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, unknown>;
  /**
   * Inserts the preferred language only when the account has
   * none, never overwriting a saved preference. Account creation seeds it
   * from the initiating site locale, retrying and rejecting the hook on a
   * persistent failure. Every sign-in captures it from the callback locale
   * for accounts that predate the preference, and a capture failure never
   * blocks the login.
   */
  readonly createAccountLocalePreference: (
    accountId: CustomerAccountId,
    locale: Locale
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
};

/**
 * Seeds the preference at account creation. The insert is idempotent (it
 * never overwrites a saved preference), so a transient database failure is
 * retried under the shared read retry policy with the same initiating
 * locale. A permanent or exhausted failure is logged with a fixed code and
 * fails the activating request.
 */
const seedLocalePreference = (
  config: WorkspaceAuthConfig,
  accountId: CustomerAccountId,
  locale: Locale
) =>
  config.createAccountLocalePreference(accountId, locale).pipe(
    retryDatabaseRead,
    Effect.tapError(() =>
      Effect.logWarning(
        "Customer language preference seed failed; rejecting account activation.",
        { code: "account-locale-preference.seed-failed" }
      )
    )
  );

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
  locale: Schema.optional(Schema.Literals(locales)),
});

/** The initiating site locale in the magic-link metadata, else the default. */
const decodeMagicLinkLocale = (
  data: Parameters<MagicLinkSendFunction>[0]
): Locale =>
  Option.getOrUndefined(
    Schema.decodeOption(magicLinkMetadataSchema)(data.metadata ?? {})
  )?.locale ?? defaultLocale;

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
  const parsed = URL.parse(callbackURL, "https://auth.internal.invalid");
  return parsed ? getLocaleFromPathname(parsed.pathname, locales) : undefined;
};

/**
 * Captures the sign-in callback locale as the preference of an account that
 * has none, such as one created before preferences existed. The insert never
 * overwrites a saved preference. A failure is logged with a fixed code and
 * never blocks the login: readers fall back without a preference, and the
 * next sign-in retries.
 */
const captureLocalePreference = (
  config: WorkspaceAuthConfig,
  accountId: CustomerAccountId,
  locale: Locale
) =>
  config
    .createAccountLocalePreference(accountId, locale)
    .pipe(
      Effect.catch(() =>
        Effect.logWarning(
          "Customer language preference capture failed; continuing the sign-in.",
          { code: "account-locale-preference.capture-failed" }
        )
      )
    );

/** The deleting session's user id is not a customer account id. */
class DeletingAccountIdInvalidError extends Data.TaggedError(
  "DeletingAccountIdInvalidError"
)<Record<never, never>> {
  override readonly message =
    "The deleting session carried an invalid account identifier.";
}

/** The account id of a Better Auth user or session, when it is one of ours. */
const decodeAccountId = (userId: string) =>
  Option.getOrUndefined(Schema.decodeOption(customerAccountIdSchema)(userId));

/** Decodes the auth request context, the hooks' I/O boundary. */
const decodeAuthContext = Schema.decodeUnknownOption(authContextSchema);

/**
 * Rejects magic-link requests while accounts are disabled (an unreadable
 * flag counts as disabled) and any request carrying profile fields.
 */
const guardAuthRequest = Effect.fn("WorkspaceAuth.guardRequest")(function* (
  config: WorkspaceAuthConfig,
  ctx: { readonly path: string; readonly body?: unknown }
) {
  if (accountMagicLinkPaths.has(ctx.path)) {
    const enabled = yield* Effect.tryPromise(() =>
      config.areAccountsEnabled()
    ).pipe(Effect.orElseSucceed(() => false));
    if (!enabled) return yield* Effect.fail(makeAccountsUnavailableError());
  }

  const body = ctx.body;
  const hasProfileFields =
    ctx.path === "/sign-in/magic-link" &&
    Predicate.isObject(body) &&
    (Object.hasOwn(body, "name") || Object.hasOwn(body, "image"));

  if (ctx.path === "/update-user" || hasProfileFields) {
    return yield* Effect.fail(
      new APIError("BAD_REQUEST", {
        message: "Profile fields are not accepted.",
      })
    );
  }
});

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
      before: createAuthMiddleware((ctx) =>
        runWorkspaceEffect("account.auth.guard", { boundary: "route" })(
          guardAuthRequest(config, ctx)
        )
      ),
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
          before: (session, ctx) =>
            runWorkspaceEffect("account.auth.capture-locale", {
              boundary: "route",
            })(
              Effect.gen(function* () {
                const accountId = decodeAccountId(session.userId);
                const locale = callbackLocaleFromAuthContext(
                  Option.getOrElse(decodeAuthContext(ctx), () => ({}))
                );
                if (accountId && locale) {
                  yield* captureLocalePreference(config, accountId, locale);
                }
                return {
                  data: {
                    ...session,
                    ipAddress: null,
                    userAgent: null,
                  },
                };
              })
            ),
        },
      },
      user: {
        create: {
          after: (user, ctx) =>
            runWorkspaceEffect("account.locale-preference.seed", {
              boundary: "route",
            })(
              Effect.gen(function* () {
                const accountId = decodeAccountId(user.id);
                if (!accountId) return;
                // The user row is already committed when this hook runs, so a
                // failed seed must fail the activating request. A later
                // sign-in captures the preference from its own callback
                // locale. Anything without a callback locale seeds the site
                // default.
                yield* seedLocalePreference(
                  config,
                  accountId,
                  callbackLocaleFromAuthContext(
                    Option.getOrElse(decodeAuthContext(ctx), () => ({}))
                  ) ?? defaultLocale
                );
              })
            ),
        },
      },
    },
    user: {
      ...authOptions.user,
      deleteUser: {
        ...authOptions.user?.deleteUser,
        enabled: true,
        beforeDelete: (user) =>
          runWorkspaceEffect("account.deletion.provider-expiration", {
            boundary: "task",
          })(
            Effect.gen(function* () {
              const accountId = decodeAccountId(user.id);
              if (!accountId) {
                return yield* new DeletingAccountIdInvalidError();
              }
              yield* config.beforeDeleteUser(accountId);
            })
          ),
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

export const workspaceSendMagicLink: MagicLinkSendFunction = (data) =>
  runWorkspaceEffect("account.magic-link.locale", { boundary: "route" })(
    lookupMagicLinkDeliveryLocale(data.email).pipe(
      Effect.provide(WorkspaceDatabase.Default),
      Effect.orElseSucceed(() => ({ kind: "read-failed" }) as const),
      Effect.map((lookup) =>
        decideMagicLinkDelivery(lookup, decodeMagicLinkLocale(data))
      ),
      Effect.flatMap((decision) =>
        Match.value(decision).pipe(
          Match.discriminatorsExhaustive("action")({
            skip: ({ code }) =>
              Effect.logWarning(
                "Magic-link delivery skipped for an existing account with an unreadable language preference.",
                { code }
              ),
            deliver: ({ locale }) =>
              Effect.sync(() =>
                after(() =>
                  runWorkspaceEffect("account.magic-link.deliver", {
                    boundary: "task",
                  })(
                    makeWorkspaceMagicLinkDelivery().deliver({
                      email: data.email,
                      url: data.url,
                      locale,
                    })
                  )
                )
              ),
          })
        )
      )
    )
  );

export const workspaceBeforeDeleteUser = (accountId: CustomerAccountId) =>
  Effect.flatMap(CustomerAccountDeletionService, (service) =>
    service.requestDeletion(accountId)
  ).pipe(Effect.provide(CustomerAccountDeletionService.Live));
