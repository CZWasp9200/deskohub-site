import type { AuthContext, DBAdapter } from "better-auth";
import { Data, Effect } from "effect";
import {
  betterAuthMagicLinkOptions,
  digestVerificationKey,
  signInEmailLimit,
} from "./auth-options";

/**
 * The sign-in code rides in the same email as the magic link: one email is
 * one sign-in. The code lives in Better Auth's email-OTP row; a sibling row
 * points at the link's stored identifier so a code sign-in can remove the
 * link, and a link sign-in removes the code.
 */

type VerificationStore = Pick<
  AuthContext["internalAdapter"],
  | "createVerificationValue"
  | "deleteVerificationByIdentifier"
  | "findVerificationValue"
>;

/** A sign-in code or link row could not be read or written. */
export class SignInCodeStorageError extends Data.TaggedError(
  "SignInCodeStorageError"
)<{ readonly code: "account.sign-in-code.storage" }> {
  constructor() {
    super({ code: "account.sign-in-code.storage" });
  }
}

const store = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: () => new SignInCodeStorageError(),
  });

/**
 * Better Auth lowercases the email in its OTP identifiers, while the
 * magic-link row keeps the address as typed.
 */
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The email-OTP plugin's identifier for an email's sign-in code. */
const signInCodeIdentifier = (email: string) =>
  `sign-in-otp-${normalizeEmail(email)}`;

/** Points at the stored identifier of the link sent with the latest code. */
const signInLinkIdentifier = (email: string) =>
  `sign-in-link-${normalizeEmail(email)}`;

/**
 * Issues the code for a sign-in email. Earlier codes for the email are
 * deleted first, so only the newest email's code works and no duplicate rows
 * accumulate. The sibling row records the link sent with this code.
 */
export const issueSignInCode = Effect.fn("SignInCode.issue")(function* (
  verifications: VerificationStore,
  createCode: (email: string) => Promise<string>,
  link: { readonly email: string; readonly token: string }
) {
  yield* store(() =>
    verifications.deleteVerificationByIdentifier(
      signInCodeIdentifier(link.email)
    )
  );
  const code = yield* store(() => createCode(normalizeEmail(link.email)));
  const linkIdentifier = signInLinkIdentifier(link.email);
  yield* store(() =>
    verifications.deleteVerificationByIdentifier(linkIdentifier)
  );
  yield* store(async () =>
    verifications.createVerificationValue({
      identifier: linkIdentifier,
      value: await digestVerificationKey(link.token),
      expiresAt: new Date(
        Date.now() + betterAuthMagicLinkOptions.expiresIn * 1000
      ),
    })
  );
  return code;
});

/** A link sign-in ends the email's pending code. */
export const revokeSignInCode = Effect.fn("SignInCode.revoke")(function* (
  verifications: VerificationStore,
  email: string
) {
  yield* store(() =>
    verifications.deleteVerificationByIdentifier(signInCodeIdentifier(email))
  );
  yield* store(() =>
    verifications.deleteVerificationByIdentifier(signInLinkIdentifier(email))
  );
});

/** A code sign-in ends the link that was sent with the code. */
export const revokeSignInLink = Effect.fn("SignInCode.revokeLink")(function* (
  verifications: VerificationStore,
  email: string
) {
  const identifier = signInLinkIdentifier(email);
  const sibling = yield* store(() =>
    verifications.findVerificationValue(identifier)
  );
  if (sibling) {
    yield* store(() =>
      verifications.deleteVerificationByIdentifier(sibling.value)
    );
  }
  yield* store(() => verifications.deleteVerificationByIdentifier(identifier));
});

type SendLedger = Pick<DBAdapter, "count" | "create" | "delete">;

/**
 * Records a sign-in email for the address unless it already received
 * `signInEmailLimit.max` within the rolling window. Each send is one
 * verification row keyed by a digest of the address, expiring with the
 * window, so the auth cleanup cron removes it. The row is written before
 * counting: concurrent sends can only under-admit, never exceed the limit.
 */
export const reserveSignInEmail = Effect.fn("SignInCode.reserveEmail")(
  function* (ledger: SendLedger, email: string) {
    const identifier = `sign-in-email-${yield* store(() =>
      digestVerificationKey(normalizeEmail(email))
    )}`;
    const now = Date.now();
    const row = yield* store(() =>
      ledger.create<{ readonly id: string }>({
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
      ledger.count({
        model: "verification",
        where: [
          { field: "identifier", value: identifier },
          { field: "expiresAt", operator: "gt", value: new Date(now) },
        ],
      })
    );
    if (sends <= signInEmailLimit.max) return true;
    yield* store(() =>
      ledger.delete({
        model: "verification",
        where: [{ field: "id", value: row.id }],
      })
    );
    return false;
  }
);
