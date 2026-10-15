"use client";

import { Option, Predicate, Schema } from "effect";
import { getAccountPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { listenForReturn } from "@/shared/browser/return-window";
import { authClient } from "./auth.client";
import { signInCodeDevStub } from "./sign-in-code.dev-stub";

const RETURN_LISTENER_TTL_MS = 10 * 60 * 1000;
const FRESH_SESSION_WINDOW_MS = 10 * 60 * 1000;

const sessionCreatedAtSchema = Schema.Union([
  Schema.Date,
  Schema.String,
  Schema.Finite,
]);
const sessionResponseSchema = Schema.Struct({
  data: Schema.NullOr(
    Schema.Struct({
      session: Schema.Struct({
        createdAt: Schema.optional(sessionCreatedAtSchema),
      }),
      user: Schema.Struct({
        emailVerified: Schema.Boolean,
      }),
    })
  ),
  error: Schema.NullOr(Schema.Unknown),
});
const decodeSessionResponse = Schema.decodeUnknownOption(sessionResponseSchema);
type SessionResponse = typeof sessionResponseSchema.Type;
type SessionData = NonNullable<SessionResponse["data"]>;
type SessionCreatedAt = typeof sessionCreatedAtSchema.Type;

type AuthReturnLifecycleOptions = {
  readonly locale: Locale;
  readonly requireFreshSession?: boolean;
};

type MagicLinkResult = Awaited<ReturnType<typeof authClient.signIn.magicLink>>;

export type SignInCodeVerification =
  | "verified"
  | "invalid"
  | "expired"
  | "too-many-attempts"
  | "failed";

export type AuthReturnLifecycle = {
  readonly cancel: () => void;
  readonly continueToAccount: () => boolean;
  readonly sendMagicLink: (email: string) => Promise<MagicLinkResult>;
  readonly verifyCode: (
    email: string,
    code: string
  ) => Promise<SignInCodeVerification>;
};

/** True when the server also put a sign-in code into the magic-link email. */
export const hasIssuedSignInCode = (result: MagicLinkResult): boolean =>
  Predicate.hasProperty(result.data, "signInCode") &&
  result.data.signInCode === true;

const signInCodeFailures: Readonly<
  Record<string, Exclude<SignInCodeVerification, "verified">>
> = {
  INVALID_OTP: "invalid",
  OTP_EXPIRED: "expired",
  TOO_MANY_ATTEMPTS: "too-many-attempts",
};

const toSignInCodeFailure = (error: unknown) =>
  (Predicate.hasProperty(error, "code") && Predicate.isString(error.code)
    ? signInCodeFailures[error.code]
    : undefined) ?? "failed";

const noop = () => undefined;

// Browser coordination APIs are best effort: a throwing API reads as absent.
const detectReturnWindowSupport = Option.liftThrowable(
  (): boolean =>
    Predicate.isFunction(globalThis.crypto?.randomUUID) &&
    Predicate.isFunction(globalThis.BroadcastChannel) &&
    Predicate.isFunction(globalThis.navigator?.locks?.request)
);

const generateAttemptId = Option.liftThrowable((): string | undefined => {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (!Predicate.isFunction(randomUUID)) return undefined;
  const attemptId = randomUUID.call(globalThis.crypto);
  return Predicate.isString(attemptId) ? attemptId : undefined;
});

const hasReturnWindowSupport = (): boolean =>
  Option.getOrElse(detectReturnWindowSupport(), () => false);

const createAttemptId = (): string | undefined =>
  Option.getOrUndefined(generateAttemptId());

const readSessionResponse = async (): Promise<SessionResponse | undefined> =>
  Option.getOrUndefined(
    decodeSessionResponse(
      await authClient.getSession({
        fetchOptions: { cache: "no-store" },
        query: { disableCookieCache: true },
      })
    )
  );

const toCreatedAtMillis = (value: SessionCreatedAt | undefined): number => {
  if (value instanceof Date) return value.getTime();
  return value === undefined ? Number.NaN : new Date(value).getTime();
};

const isFreshSession = (createdAt: SessionCreatedAt | undefined) => {
  const createdAtMillis = toCreatedAtMillis(createdAt);
  return (
    Number.isFinite(createdAtMillis) &&
    Date.now() - createdAtMillis < FRESH_SESSION_WINDOW_MS
  );
};

const isUsableSession = (
  value: SessionData | null,
  requireFreshSession: boolean
): boolean =>
  value !== null &&
  value.user.emailVerified === true &&
  (!requireFreshSession || isFreshSession(value.session.createdAt));

const hasAuthenticatedSession = (
  value: SessionResponse | undefined,
  requireFreshSession: boolean
) =>
  value !== undefined &&
  value.error === null &&
  isUsableSession(value.data, requireFreshSession);

// Refocusing is best effort and must not change the navigation result.
const focusWindow = Option.liftThrowable(() => globalThis.window?.focus?.());

const requestAccountNavigation = Option.liftThrowable(
  (locale: Locale): boolean => {
    const replace = globalThis.window?.location?.replace;
    if (!Predicate.isFunction(replace)) return false;
    replace.call(globalThis.window.location, getAccountPath(locale));
    return true;
  }
);

const navigateToAccount = (locale: Locale): boolean => {
  const navigated = Option.getOrElse(
    requestAccountNavigation(locale),
    () => false
  );
  if (navigated) focusWindow();
  return navigated;
};

// Return-window cleanup is best effort.
const runCleanup = Option.liftThrowable((cleanup: () => void) => cleanup());

// A coordination failure falls back to the ordinary callback.
const listenForReturnSafely = Option.liftThrowable(listenForReturn);

export const createAuthReturnLifecycle = ({
  locale,
  requireFreshSession = false,
}: AuthReturnLifecycleOptions): AuthReturnLifecycle => {
  let currentCleanup: () => void = noop;
  let requestEpoch = 0;

  const dispose = () => {
    const cleanup = currentCleanup;
    currentCleanup = noop;
    runCleanup(cleanup);
  };

  const cancel = () => {
    requestEpoch += 1;
    dispose();
  };

  const sendMagicLink = async (email: string) => {
    const requestId = requestEpoch + 1;
    requestEpoch = requestId;
    dispose();

    const callbackPath = `/${locale}/auth/callback`;
    let callbackURL = callbackPath;

    if (hasReturnWindowSupport()) {
      const attemptId = createAttemptId();
      if (attemptId !== undefined) {
        const cleanup = Option.getOrUndefined(
          listenForReturnSafely({
            attemptId,
            onReturn: async (signal) => {
              if (signal.aborted || requestEpoch !== requestId) return false;

              let sessionResponse: SessionResponse | undefined;
              try {
                sessionResponse = await readSessionResponse();
              } catch {
                return false;
              }
              if (
                signal.aborted ||
                requestEpoch !== requestId ||
                !hasAuthenticatedSession(sessionResponse, requireFreshSession)
              ) {
                return false;
              }
              if (signal.aborted || requestEpoch !== requestId) return false;
              return navigateToAccount(locale);
            },
            ttlMs: RETURN_LISTENER_TTL_MS,
          })
        );
        if (cleanup) {
          currentCleanup = cleanup;
          callbackURL = `${callbackPath}?attempt=${encodeURIComponent(attemptId)}`;
        }
      }
    }

    try {
      const result = signInCodeDevStub
        ? await signInCodeDevStub.sendMagicLink()
        : await authClient.signIn.magicLink({
            email,
            callbackURL,
            metadata: { locale },
          });
      if (requestEpoch === requestId && result.error) dispose();
      return result;
    } catch (cause) {
      if (requestEpoch === requestId) dispose();
      throw cause;
    }
  };

  // A verified code signs this tab in directly, so the link hand-off stops
  // listening and a late link tab can't trigger a second navigation.
  const verifyCode = async (
    email: string,
    code: string
  ): Promise<SignInCodeVerification> => {
    try {
      const result = signInCodeDevStub
        ? await signInCodeDevStub.verifyCode(code)
        : await authClient.signIn.emailOtp({ email, otp: code });
      if (result.error) return toSignInCodeFailure(result.error);
      cancel();
      return "verified";
    } catch {
      return "failed";
    }
  };

  const continueToAccount = () => navigateToAccount(locale);

  return { cancel, continueToAccount, sendMagicLink, verifyCode };
};
