import type { AuthContext, DBAdapter } from "better-auth";
import { Data, Effect } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { PostgresAdvisoryLockKey } from "@/db/postgres-advisory-lock";
import {
  betterAuthMagicLinkOptions,
  digestVerificationKey,
  signInEmailLimit,
} from "./auth-options";

/**
 * The sign-in code rides in the same email as the magic link: one email is
 * one sign-in. Each email that carries a code gets a claim row keyed by its
 * link, and a binding row that leads from the code to that claim. The link
 * takes the claim before Better Auth consumes it, and the code takes it
 * before Better Auth creates the session, so only the first of the two
 * signs in. Codes are issued one email address at a time, and each issue
 * replaces the address's earlier code.
 */

/** The verification-table operations this module needs on its own rows. */
type VerificationRows = Pick<
  DBAdapter,
  "count" | "create" | "delete" | "findOne" | "updateMany"
>;

type StoredVerifications = Pick<
  AuthContext["internalAdapter"],
  "deleteVerificationByIdentifier"
>;

/**
 * Runs an effect while it holds the lock for a key: a transaction-scoped
 * Postgres advisory lock in production.
 */
export type SignInEmailLock = <A, E>(
  key: PostgresAdvisoryLockKey,
  effect: Effect.Effect<A, E>
) => Effect.Effect<A, E | SqlError.SqlError>;

/** A sign-in code or link row could not be read or written. */
export class SignInCodeStorageError extends Data.TaggedError(
  "SignInCodeStorageError"
)<{ readonly code: "account.sign-in-code.storage" }> {
  constructor() {
    super({ code: "account.sign-in-code.storage" });
  }
}

/** The link sent with this code already signed in. */
export class SignInEmailUsedError extends Data.TaggedError(
  "SignInEmailUsedError"
)<Record<never, never>> {}

const store = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: () => new SignInCodeStorageError(),
  });

const digest = (value: string) =>
  Effect.promise(() => digestVerificationKey(value));

/**
 * Better Auth lowercases the email in its OTP identifiers, while the
 * magic-link row keeps the address as typed.
 */
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The email-OTP plugin's identifier for an email's sign-in code. */
const signInCodeIdentifier = (email: string) =>
  `sign-in-otp-${normalizeEmail(email)}`;

const signInEmailLockKey = ({ email }: { readonly email: string }) =>
  digest(normalizeEmail(email)).pipe(
    Effect.map((address): PostgresAdvisoryLockKey => ["sign-in-email", address])
  );

/** The claim row of the sign-in email that carried this link. */
const claimIdentifier = ({ token }: { readonly token: string }) =>
  digest(token).pipe(Effect.map((link) => `sign-in-claim-${link}`));

/** The row binding one code of one address to its email's claim. */
const codeBindingIdentifier = ({
  email,
  code,
}: {
  readonly email: string;
  readonly code: string;
}) =>
  digest(`${normalizeEmail(email)}:${code}`).pipe(
    Effect.map((binding) => `sign-in-code-${binding}`)
  );

const openClaim = "open";
const takenClaim = "taken";

type SignInCodeIssue = {
  /** The sign-in email's address and its magic-link token. */
  readonly email: string;
  readonly token: string;
  readonly verifications: VerificationRows;
  readonly signInCodes: StoredVerifications;
  readonly createSignInCode: (email: string) => Promise<string>;
  readonly withSignInEmailLock: SignInEmailLock;
};

/**
 * Better Auth's `createVerificationOTP` only inserts, so the address's
 * earlier code is deleted first and only the newest email's code works.
 */
const replaceSignInCode = ({
  email,
  signInCodes,
  createSignInCode,
}: SignInCodeIssue) =>
  store(() =>
    signInCodes.deleteVerificationByIdentifier(signInCodeIdentifier(email))
  ).pipe(Effect.andThen(store(() => createSignInCode(normalizeEmail(email)))));

const writeClaimRows = ({
  verifications,
  claim,
  binding,
}: {
  readonly verifications: VerificationRows;
  readonly claim: string;
  readonly binding: string;
}) =>
  store(async () => {
    const now = Date.now();
    const rows = [
      { identifier: claim, value: openClaim },
      { identifier: binding, value: claim },
    ];
    for (const row of rows) {
      await verifications.create({
        model: "verification",
        data: {
          ...row,
          expiresAt: new Date(
            now + betterAuthMagicLinkOptions.expiresIn * 1000
          ),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
      });
    }
  });

/**
 * Issues the code for a sign-in email and binds it to the email's claim.
 * Issues for one address run one at a time, so the newest code is the only
 * one stored and its binding leads to its own link's claim.
 */
export const issueSignInCode = (issue: SignInCodeIssue) =>
  Effect.succeed(issue).pipe(
    Effect.bind("claim", claimIdentifier),
    Effect.bind("code", replaceSignInCode),
    Effect.bind("binding", ({ email, code }) =>
      codeBindingIdentifier({ email, code })
    ),
    Effect.tap(writeClaimRows),
    Effect.map(({ code }) => code),
    (issuance) =>
      Effect.flatMap(signInEmailLockKey(issue), (key) =>
        issue.withSignInEmailLock(key, issuance)
      ),
    Effect.mapError(() => new SignInCodeStorageError()),
    Effect.withSpan("SignInCode.issue")
  );

/**
 * Takes an email's claim. `unclaimed` means the email carries no code, as
 * every email sent while sign-in codes are off.
 */
const takeClaim = Effect.fn("SignInCode.takeClaim")(function* ({
  verifications,
  claim,
}: {
  readonly verifications: VerificationRows;
  readonly claim: string;
}) {
  const taken = yield* store(() =>
    verifications.updateMany({
      model: "verification",
      where: [
        { field: "identifier", value: claim },
        { field: "value", value: openClaim },
      ],
      update: { value: takenClaim, updatedAt: new Date() },
    })
  );
  if (taken > 0) return "won" as const;
  const row = yield* store(() =>
    verifications.findOne({
      model: "verification",
      where: [{ field: "identifier", value: claim }],
    })
  );
  return row ? ("lost" as const) : ("unclaimed" as const);
});

/** Better Auth stores a link under the digest of its token. */
const revokeLink = ({
  token,
  signInLinks,
}: {
  readonly token: string;
  readonly signInLinks: StoredVerifications;
}) =>
  digest(token).pipe(
    Effect.flatMap((link) =>
      store(() => signInLinks.deleteVerificationByIdentifier(link))
    )
  );

/**
 * Runs before Better Auth consumes a magic link. When the code sent with the
 * link already signed in, the link is deleted, so Better Auth rejects it like
 * any used link.
 */
export const claimSignInLink = (request: {
  readonly token: string;
  readonly verifications: VerificationRows;
  readonly signInLinks: StoredVerifications;
}) =>
  Effect.succeed(request).pipe(
    Effect.bind("claim", claimIdentifier),
    Effect.bind("outcome", takeClaim),
    Effect.tap(({ outcome }) =>
      revokeLink(request).pipe(Effect.when(Effect.succeed(outcome === "lost")))
    ),
    Effect.asVoid,
    Effect.withSpan("SignInCode.claimLink")
  );

/**
 * The claim a code's binding leads to. A code without one counts as used:
 * only an issue that never finished leaves one behind.
 */
const findBoundClaim = ({
  verifications,
  binding,
}: {
  readonly verifications: VerificationRows;
  readonly binding: string;
}) =>
  store(() =>
    verifications.findOne<{ readonly value: string }>({
      model: "verification",
      where: [{ field: "identifier", value: binding }],
    })
  ).pipe(
    Effect.flatMap((row) => Effect.fromNullishOr(row?.value)),
    Effect.catchTag("NoSuchElementError", () =>
      Effect.fail(new SignInEmailUsedError())
    )
  );

/**
 * Runs after Better Auth accepts a code and before it creates the session.
 * Fails when the email's link signed in first.
 */
export const claimSignInCode = (request: {
  readonly email: string;
  readonly code: string;
  readonly verifications: VerificationRows;
}) =>
  Effect.succeed(request).pipe(
    Effect.bind("binding", codeBindingIdentifier),
    Effect.bind("claim", findBoundClaim),
    Effect.bind("outcome", takeClaim),
    Effect.filterOrFail(
      ({ outcome }) => outcome === "won",
      () => new SignInEmailUsedError()
    ),
    Effect.asVoid,
    Effect.withSpan("SignInCode.claimCode")
  );

/**
 * Records a sign-in email for the address unless it already received
 * `signInEmailLimit.max` within the rolling window. Each send is one
 * verification row keyed by a digest of the address, expiring with the
 * window, so the auth cleanup cron removes it. The row is written before
 * counting: concurrent sends can only under-admit, never exceed the limit.
 */
export const reserveSignInEmail = Effect.fn("SignInCode.reserveEmail")(
  function* ({
    verifications,
    email,
  }: {
    readonly verifications: VerificationRows;
    readonly email: string;
  }) {
    const identifier = `sign-in-email-${yield* digest(normalizeEmail(email))}`;
    const now = Date.now();
    const row = yield* store(() =>
      verifications.create<{ readonly id: string }>({
        model: "verification",
        data: {
          identifier,
          value: "sent",
          expiresAt: new Date(now + signInEmailLimit.window * 1000),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
      })
    );
    const sends = yield* store(() =>
      verifications.count({
        model: "verification",
        where: [
          { field: "identifier", value: identifier },
          { field: "expiresAt", operator: "gt", value: new Date(now) },
        ],
      })
    );
    if (sends <= signInEmailLimit.max) return true;
    yield* store(() =>
      verifications.delete({
        model: "verification",
        where: [{ field: "id", value: row.id }],
      })
    );
    return false;
  }
);
