import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import { authSession, authUser } from "@/db/schema/auth";
import { customerAccountLinks } from "@/db/schema/customer-account-links";
import { parseBetterAuthSecrets } from "@/features/account/backend/auth/auth-secrets";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import { setBrowserCookie } from "../browser";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { addRedaction, type Runner } from "../runtime";

/**
 * Better Auth's session cookie on an HTTPS deployment. Workspace keeps the
 * library's default prefix and enables HTTPS-only cookies outside local
 * development, so every protected preview uses the `__Secure-` name.
 */
export const workspaceE2ESessionCookieName =
  "__Secure-better-auth.session_token";

/**
 * Seeded sessions only need to outlive one case; a short expiry bounds the
 * value of a leaked preview cookie even before cleanup deletes the user.
 */
const seededSessionLifetimeMs = 60 * 60_000;

/** The preview's current Better Auth signing secret: the first configured entry. */
export type WorkspaceE2ESessionSigningSecret = {
  readonly value: string;
};

/**
 * Decodes the runner-only copy of the protected preview's versioned
 * `BETTER_AUTH_SECRETS`. Only the first entry signs, as in Better Auth. Every
 * entry is registered with the redactor before it can reach a log, and an
 * absent or malformed value fails closed without echoing it.
 */
export const resolveWorkspaceE2ESessionSigningSecret = (
  environment: Pick<
    WorkspaceE2EEnvironment,
    "WORKSPACE_E2E_BETTER_AUTH_SECRETS"
  >
): WorkspaceE2ESessionSigningSecret => {
  const raw = environment.WORKSPACE_E2E_BETTER_AUTH_SECRETS;
  addRedaction(raw, true);
  const parsed = parseBetterAuthSecrets(raw);
  if (parsed.kind === "invalid") {
    throw workspaceE2EError(
      "WORKSPACE_E2E_BETTER_AUTH_SECRETS must hold the Preview deployment's versioned BETTER_AUTH_SECRETS value. Provision it as a secret of the protected workspace-checkout-e2e GitHub Actions environment, copied from the deskohub-workspace Vercel project's Preview-only BETTER_AUTH_SECRETS (never the Production value), before running the referral lane. Referral coverage fails closed instead of skipping",
      { operation: "configure workspace e2e session seeding" }
    );
  }
  for (const secret of parsed.secrets) addRedaction(secret.value, true);
  return { value: parsed.secrets[0].value };
};

/**
 * Signs a session token exactly as Better Auth's signed cookie does: the
 * token, a dot, and the base64 HMAC-SHA-256 of the token, URI-encoded.
 */
export const signWorkspaceE2ESessionToken = async (
  token: string,
  secret: WorkspaceE2ESessionSigningSecret
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.value),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token)
  );
  return encodeURIComponent(
    `${token}.${Buffer.from(signature).toString("base64")}`
  );
};

/** A 32-character alphanumeric token, the shape Better Auth generates. */
const generateSessionToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");

export type WorkspaceE2ESyntheticAccount = {
  readonly accountId: string;
  readonly email: string;
  /** The completed profile's customer; absent while profile completion is still required. */
  readonly linkedCustomerId?: DotyposCustomerId;
  readonly name: string;
};

/**
 * Inserts one verified synthetic Better Auth user, and its customer link when
 * the profile counts as completed. The caller journals the account id first.
 */
export const seedWorkspaceE2ESyntheticAccount = (
  account: WorkspaceE2ESyntheticAccount
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "seed synthetic account",
      db.transaction(
        Effect.fn(function* (tx) {
          yield* tx.insert(authUser).values({
            deletionRequestedAt: null,
            email: sensitiveDatabaseParameter(account.email),
            emailVerified: true,
            id: account.accountId,
            name: account.name,
          });
          if (account.linkedCustomerId) {
            yield* tx.insert(customerAccountLinks).values({
              customerAccountId: account.accountId,
              dotyposCustomerId: account.linkedCustomerId,
            });
          }
        })
      )
    );
  });

/**
 * Signs a browser session in as one journaled synthetic account without a
 * magic link: it inserts a short-lived Better Auth session row into the exact
 * preview database and sets the matching signed cookie for the preview origin
 * in that session's own browser context. Nothing changes in the deployment;
 * the app authenticates the cookie through its normal session lookup.
 */
export const signInWorkspaceE2ESyntheticAccount = ({
  accountId,
  baseUrl,
  run,
  secret,
  session,
}: {
  readonly accountId: string;
  readonly baseUrl: string;
  readonly run: Runner;
  readonly secret: WorkspaceE2ESessionSigningSecret;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const token = generateSessionToken();
    addRedaction(token, true);
    const { db } = yield* E2EDatabase;
    const now = new Date();
    yield* runDatabaseOperation(
      "seed synthetic account session",
      db.insert(authSession).values({
        createdAt: now,
        expiresAt: new Date(now.getTime() + seededSessionLifetimeMs),
        id: crypto.randomUUID(),
        ipAddress: "",
        // The database query logger keeps its own censor, so the bearer
        // token must be marked sensitive rather than only redacted here.
        token: sensitiveDatabaseParameter(token),
        updatedAt: now,
        userAgent: "",
        userId: accountId,
      })
    );
    const value = yield* Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("sign synthetic account session", {
          cause,
          operation: "sign synthetic account session",
        }),
      try: () => signWorkspaceE2ESessionToken(token, secret),
    });
    addRedaction(value, true);
    yield* setBrowserCookie(run, session, {
      name: workspaceE2ESessionCookieName,
      url: baseUrl,
      value,
    });
  });
