import { CustomerAnalyticsChoice } from "@deskohub/workspace-customer-api";
import { Option, Schema } from "effect";
import type { StoredConsent } from "../consent/analytics-consent";
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
  /**
   * The app's own analytics answer, which the page takes over the site's
   * consent before its analytics can run. None when the app holds no
   * answer, or was built before it sent one; never read as consent.
   */
  readonly analytics?: NativeHandoffAnalyticsAnswer;
}

/** The app's analytics answer, dated exactly as the app stored it. */
export interface NativeHandoffAnalyticsAnswer {
  readonly granted: boolean;
  /** An ISO 8601 instant, kept byte-identical. */
  readonly decidedAt: string;
}

/** A carried answer as both the page's reader and its storage accept it. */
const analyticsAnswerSchema = Schema.Struct({
  granted: Schema.Boolean,
  decidedAt: CustomerAnalyticsChoice.fields.decidedAt,
});
const isAnalyticsAnswer = Schema.is(analyticsAnswerSchema);

/**
 * The answer the app carries to the page from its stored consent: whether
 * the stored categories include analytics, dated exactly as stored. None
 * while the answer loads, when there is none, or when its date isn't one the
 * page accepts, so the page never reads a partial answer as consent.
 */
export const handoffAnalyticsAnswer = (
  stored: StoredConsent | undefined
): NativeHandoffAnalyticsAnswer | undefined => {
  if (stored?.kind !== "decided") return undefined;
  const answer = {
    granted: stored.categories.includes("analytics"),
    decidedAt: stored.decidedAt,
  };
  return isAnalyticsAnswer(answer) ? answer : undefined;
};

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
  analytics: "analytics",
  analyticsDecidedAt: "analytics_decided_at",
} as const;

const analyticsValues = { granted: "granted", denied: "denied" } as const;

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
  if (request.analytics !== undefined) {
    search.set(
      params.analytics,
      request.analytics.granted
        ? analyticsValues.granted
        : analyticsValues.denied
    );
    search.set(params.analyticsDecidedAt, request.analytics.decidedAt);
  }
  return `${origin}${webSignInPath}?${search.toString()}`;
};

const only = (search: URLSearchParams, name: string): string | undefined => {
  const values = search.getAll(name);
  return values.length === 1 ? values[0] : undefined;
};

/**
 * The carried analytics answer: both values present once and valid, else
 * none, so a half or malformed answer never reads as one.
 */
const readAnalyticsAnswer = (
  search: URLSearchParams
): NativeHandoffAnalyticsAnswer | undefined => {
  const value = only(search, params.analytics);
  if (value !== analyticsValues.granted && value !== analyticsValues.denied) {
    return undefined;
  }
  const answer = {
    granted: value === analyticsValues.granted,
    decidedAt: only(search, params.analyticsDecidedAt),
  };
  return isAnalyticsAnswer(answer) ? answer : undefined;
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
  // Neither does the analytics answer: without one the page keeps analytics
  // off, which the sign-in doesn't need.
  const analytics = readAnalyticsAnswer(search);
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
    ...(analytics === undefined ? {} : { analytics }),
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
      // Checked on its own below, so a bad answer drops only itself.
      analytics: Schema.optionalKey(Schema.Unknown),
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

/**
 * The stored request, unless it is absent, malformed or expired. A malformed
 * analytics answer is dropped like a malformed one on the address, keeping
 * the request, and with it the page's hand-off analytics gate.
 */
export const restoreNativeHandoffRequest = (
  raw: string | null,
  now: number
): Option.Option<NativeHandoffRequest> =>
  Option.fromNullishOr(raw).pipe(
    Option.flatMap(decodeStoredRequest),
    Option.filter(({ expiresAt }) => now < expiresAt),
    Option.map(({ request: { analytics, ...request } }) =>
      isAnalyticsAnswer(analytics) ? { ...request, analytics } : request
    )
  );
