import type { BetterAuthPlugin, DBAdapter } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { Data, Effect, Option, Schema } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  betterAuthMagicLinkOptions,
  digestVerificationKey,
} from "./auth-options";

/**
 * Sign-in attempts tell the `/app/` page that its email's link signed in
 * somewhere else, usually in the app after the link opened from the mail app.
 *
 * Each sign-in email sent for the app callback gets an attempt: a random
 * secret the send response hands to the page, and a row keyed by the email's
 * link that keeps only the attempt's digest. A verification of that link that
 * signs in marks the attempt completed. The page asks the status endpoint
 * with the attempts it holds; the secret is the only key, and the answer is
 * one bit, so the endpoint needs no session and no BotID check.
 *
 * Only link sign-ins mark an attempt. A code typed on the page finishes on the
 * page itself.
 */

/** The verification-table operations this module needs on its own rows. */
type SignInAttemptRows = Pick<
  DBAdapter,
  "create" | "deleteMany" | "findOne" | "findMany"
>;

/** A row of this module could not be read or written. */
class SignInAttemptStorageError extends Data.TaggedError(
  "SignInAttemptStorageError"
)<{ readonly code: "account.sign-in-attempt.storage" }> {
  constructor() {
    super({ code: "account.sign-in-attempt.storage" });
  }
}

const store = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: () => new SignInAttemptStorageError(),
  });

const digest = (value: string) =>
  Effect.promise(() => digestVerificationKey(value));

/** Attempts live as long as the link they were sent with. */
const attemptLifetimeMs = betterAuthMagicLinkOptions.expiresIn * 1000;

/** The row binding a sent link to the digest of its email's attempt. */
const linkIdentifier = (token: string) =>
  digest(token).pipe(Effect.map((link) => `sign-in-attempt-link-${link}`));

/** The row saying the attempt with this digest signed in. */
const completedIdentifier = (attemptDigest: string) =>
  `sign-in-attempt-completed-${attemptDigest}`;

const createRow = (
  rows: SignInAttemptRows,
  {
    identifier,
    value,
    expiresAt,
  }: {
    readonly identifier: string;
    readonly value: string;
    /** Defaults to a full link lifetime from now. */
    readonly expiresAt?: Date;
  }
) =>
  store(() => {
    const now = Date.now();
    return rows.create({
      model: "verification",
      data: {
        identifier,
        value,
        expiresAt: expiresAt ?? new Date(now + attemptLifetimeMs),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    });
  });

/** A new attempt for a sign-in email sent for the app callback. */
export const issueSignInAttempt = (): string => generateRandomString(43);

/**
 * Binds the email's link to its attempt. A row that can't be written costs
 * only the page's notice, so the email still goes out.
 */
export const recordSignInAttemptLink = Effect.fn("SignInAttempt.recordLink")(
  function* ({
    rows,
    token,
    attempt,
  }: {
    readonly rows: SignInAttemptRows;
    readonly token: string;
    readonly attempt: string;
  }) {
    const identifier = yield* linkIdentifier(token);
    const value = yield* digest(attempt);
    yield* createRow(rows, { identifier, value }).pipe(
      Effect.catchTag("SignInAttemptStorageError", ({ code }) =>
        Effect.logWarning("Sign-in attempt not recorded.", { code })
      )
    );
  }
);

type VerificationRow = {
  readonly value: string;
  readonly expiresAt: Date;
};

/**
 * Marks the attempt of the link that just signed in completed, and drops the
 * link's row. A link sent without an attempt has no row and marks nothing.
 */
const completeLinkAttempt = Effect.fn("SignInAttempt.completeLink")(function* ({
  rows,
  token,
}: {
  readonly rows: SignInAttemptRows;
  readonly token: string;
}) {
  const identifier = yield* linkIdentifier(token);
  const link = yield* store(() =>
    rows.findOne<VerificationRow>({
      model: "verification",
      where: [{ field: "identifier", value: identifier }],
    })
  );
  const live = Option.fromNullishOr(link).pipe(
    Option.filter(({ expiresAt }) => new Date(expiresAt) > new Date())
  );
  if (Option.isNone(live)) return;
  // The answer lasts as long as the attempt's link would have: completing
  // it never extends the attempt.
  yield* createRow(rows, {
    identifier: completedIdentifier(live.value.value),
    value: "completed",
    expiresAt: new Date(live.value.expiresAt),
  });
  yield* store(() =>
    rows.deleteMany({
      model: "verification",
      where: [{ field: "identifier", value: identifier }],
    })
  );
});

const verifyQuery = Schema.Struct({ token: Schema.String });

/**
 * After `/magic-link/verify` created a session, by HTTP or `auth.api`. A
 * refused or failed verification creates none and marks nothing. The session
 * stands either way, so a row that can't be written is only logged.
 */
const completeAttemptOnSignIn = createAuthMiddleware(async (ctx) => {
  if (!ctx.context.newSession) return;
  const query = Schema.decodeUnknownOption(verifyQuery)(ctx.query);
  if (Option.isNone(query)) return;
  await runWorkspaceEffect("account.sign-in-attempt.complete", {
    boundary: "route",
  })(
    completeLinkAttempt({
      rows: ctx.context.adapter,
      token: query.value.token,
    }).pipe(
      Effect.catchTag("SignInAttemptStorageError", ({ code }) =>
        Effect.logWarning("Sign-in attempt not marked completed.", { code })
      )
    )
  );
});

/** A page holds the attempts of the emails it sent in one visit. */
const maxSignInAttemptsPerStatus = 5;

const statusBody = Schema.Struct({
  attempts: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
  ).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maxSignInAttemptsPerStatus)
  ),
});

/**
 * Whether any of the attempts signed in. Unknown and expired attempts answer
 * like open ones.
 */
const isAnyAttemptCompleted = Effect.fn("SignInAttempt.isAnyCompleted")(
  function* ({
    rows,
    attempts,
  }: {
    readonly rows: SignInAttemptRows;
    readonly attempts: readonly string[];
  }) {
    const identifiers = yield* Effect.forEach(attempts, (attempt) =>
      digest(attempt).pipe(Effect.map(completedIdentifier))
    );
    const completed = yield* store(() =>
      rows.findMany<VerificationRow>({
        model: "verification",
        where: [
          { field: "identifier", operator: "in", value: identifiers },
          { field: "expiresAt", operator: "gt", value: new Date() },
        ],
        limit: 1,
      })
    );
    return completed.length > 0;
  }
);

/**
 * The status endpoint and the completion hook. Statuses allow 30 requests per
 * client IP per minute (`auth-options.ts`): one page asking every five
 * seconds, and again each time it comes back into view.
 */
export const signInAttempts = () =>
  ({
    id: "sign-in-attempt",
    endpoints: {
      signInAttemptStatus: createAuthEndpoint(
        "/sign-in-attempt/status",
        {
          method: "POST",
          body: Schema.toStandardSchemaV1(statusBody),
          metadata: { noStore: true },
        },
        async (ctx) => {
          const completed = await runWorkspaceEffect(
            "account.sign-in-attempt.status",
            { boundary: "route" }
          )(
            isAnyAttemptCompleted({
              rows: ctx.context.adapter,
              attempts: ctx.body.attempts,
            })
          );
          return ctx.json({ completed });
        }
      ),
    },
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === "/magic-link/verify",
          handler: completeAttemptOnSignIn,
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
