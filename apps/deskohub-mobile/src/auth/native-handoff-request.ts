import { Option, Schema } from "effect";
import { type AppLocale, appLocales, isAppLocale } from "../i18n/app-locale";
import { nativeReturnUri, webCallbackPath } from "./auth-callback";
import { isEmailAddress } from "./email-address";

/** Why the app asks the customer to sign in again. */
export const reauthenticationPurposes = ["delete-account"] as const;
export type ReauthenticationPurpose = (typeof reauthenticationPurposes)[number];

const isReauthenticationPurpose = (
  value: string | undefined
): value is ReauthenticationPurpose =>
  reauthenticationPurposes.some((purpose) => purpose === value);

/**
 * What the native app asks the web sign-in page for: after the customer
 * signs in there, mint a handoff code bound to this PKCE challenge and state
 * and send it to the return URI. The app builds the URL with
 * {@link nativeSignInUrl}; the page reads it back with
 * {@link readNativeHandoffRequest}, keeps it in `localStorage` for the
 * customer's other tabs (the sign-in email may open in a new one), and
 * strips it from the address bar.
 */
export interface NativeHandoffRequest {
  readonly codeChallenge: string;
  readonly state: string;
  readonly returnUri: string;
  /** Re-proves presence: the page signs in again instead of continuing. */
  readonly reauthenticate: boolean;
  /**
   * The language the app shows. The page shows it too and names it on its
   * sign-in email and code, so a new account saves it. An app built before
   * the page read it names none, and the page keeps the browser's.
   */
  readonly locale?: AppLocale;
  /**
   * The account a reauthentication signs in as. The page shows it locked, so
   * nobody confirms as someone else; the app still refuses another account's
   * session when it comes back.
   */
  readonly loginHint?: string;
  /** What a reauthentication is for, so the page can say so. */
  readonly purpose?: ReauthenticationPurpose;
}

/** The web page that runs the email sign-in for the native app. */
export const webSignInPath = "/app/sign-in";

/** A request outlives neither the browser tab's patience nor the code. */
export const nativeHandoffRequestTtlMs = 10 * 60 * 1000;

const params = {
  native: "native",
  codeChallenge: "code_challenge",
  codeChallengeMethod: "code_challenge_method",
  state: "state",
  returnUri: "return_uri",
  prompt: "prompt",
  locale: "locale",
  loginHint: "login_hint",
  purpose: "purpose",
} as const;

// base64url SHA-256: exactly 43 characters.
const challengePattern = /^[A-Za-z0-9_-]{43}$/;
// At least 32 random bytes in base64url, at most the server's 512.
const statePattern = /^[A-Za-z0-9_-]{43,512}$/;

export const nativeSignInUrl = (
  origin: string,
  request: NativeHandoffRequest
): string => {
  const search = new URLSearchParams({
    [params.native]: "1",
    [params.codeChallenge]: request.codeChallenge,
    [params.codeChallengeMethod]: "S256",
    [params.state]: request.state,
    [params.returnUri]: request.returnUri,
  });
  if (request.reauthenticate) search.set(params.prompt, "login");
  if (request.locale !== undefined) search.set(params.locale, request.locale);
  if (request.loginHint !== undefined) {
    search.set(params.loginHint, request.loginHint);
  }
  if (request.purpose !== undefined)
    search.set(params.purpose, request.purpose);
  return `${origin}${webSignInPath}?${search.toString()}`;
};

const only = (search: URLSearchParams, name: string): string | undefined => {
  const values = search.getAll(name);
  return values.length === 1 ? values[0] : undefined;
};

const isAllowedReturnUri = (value: string, siteOrigin: string): boolean =>
  value === nativeReturnUri || value === `${siteOrigin}${webCallbackPath}`;

/** The native request the sign-in page was opened with, if it is valid. */
export const readNativeHandoffRequest = (
  search: URLSearchParams,
  siteOrigin: string
): Option.Option<NativeHandoffRequest> => {
  if (only(search, params.native) !== "1") return Option.none();
  const codeChallenge = only(search, params.codeChallenge);
  const state = only(search, params.state);
  const returnUri = only(search, params.returnUri);
  const prompt = search.getAll(params.prompt);
  // The language only picks the page's copy, so a value the page doesn't
  // support leaves the browser's instead of refusing the sign-in.
  const locale = only(search, params.locale);
  // The hint and the purpose only shape what the page shows, so a value it
  // can't use leaves them out instead of refusing the sign-in.
  const loginHint = only(search, params.loginHint);
  const purpose = only(search, params.purpose);
  if (
    codeChallenge === undefined ||
    !challengePattern.test(codeChallenge) ||
    only(search, params.codeChallengeMethod) !== "S256" ||
    state === undefined ||
    !statePattern.test(state) ||
    returnUri === undefined ||
    !isAllowedReturnUri(returnUri, siteOrigin) ||
    prompt.length > 1
  ) {
    return Option.none();
  }
  return Option.some({
    codeChallenge,
    state,
    returnUri,
    reauthenticate: prompt[0] === "login",
    ...(isAppLocale(locale) ? { locale } : {}),
    ...(loginHint !== undefined && isEmailAddress(loginHint)
      ? { loginHint }
      : {}),
    ...(isReauthenticationPurpose(purpose) ? { purpose } : {}),
  });
};

const relativeUrl = (url: URL): string =>
  `${url.pathname}${url.search}${url.hash}`;

/** The current address without the native request, for `replaceState`. */
export const withoutNativeRequestParams = (href: string): string => {
  const url = new URL(href);
  for (const name of Object.values(params)) url.searchParams.delete(name);
  return relativeUrl(url);
};

const callbackCredentialParams = ["token", "code", "state", "error"] as const;

/** The callback address without its token, code, state or error. */
export const withoutCallbackCredentials = (href: string): string => {
  const url = new URL(href);
  for (const name of callbackCredentialParams) url.searchParams.delete(name);
  return relativeUrl(url);
};

const storedRequestSchema = Schema.fromJsonString(
  Schema.Struct({
    request: Schema.Struct({
      codeChallenge: Schema.String.check(Schema.isPattern(challengePattern)),
      state: Schema.String.check(Schema.isPattern(statePattern)),
      returnUri: Schema.String,
      reauthenticate: Schema.Boolean,
      locale: Schema.optionalKey(Schema.Literals(appLocales)),
      loginHint: Schema.optionalKey(
        Schema.String.check(Schema.makeFilter(isEmailAddress))
      ),
      purpose: Schema.optionalKey(Schema.Literals(reauthenticationPurposes)),
    }),
    expiresAt: Schema.Finite,
  })
);
const decodeStoredRequest = Schema.decodeUnknownOption(storedRequestSchema);

export const serializeNativeHandoffRequest = (
  request: NativeHandoffRequest,
  now: number
): string =>
  JSON.stringify({ request, expiresAt: now + nativeHandoffRequestTtlMs });

/** The stored request, unless it is absent, malformed or expired. */
export const restoreNativeHandoffRequest = (
  raw: string | null,
  now: number
): Option.Option<NativeHandoffRequest> =>
  Option.fromNullishOr(raw).pipe(
    Option.flatMap(decodeStoredRequest),
    Option.filter(({ expiresAt }) => now < expiresAt),
    Option.map(({ request }) => request)
  );
