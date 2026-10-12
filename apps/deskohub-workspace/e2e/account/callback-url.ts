import type * as Playwright from "@playwright/test";

const callbackPath = "/en-US/auth/callback";
const attemptParamName = "attempt";
const referralParamName = "ref";
const failureParamName = "error";
const invalidTokenFailureValue = "INVALID_TOKEN";
// Canonical lowercase UUIDv4 shape only; production mints the handoff attempt
// parameter in this exact grammar.
const canonicalUuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * What the callback query must carry beyond the optional `attempt`: the exact
 * share code when the sign-in started from a referral share link.
 */
export type CallbackUrlExpectation = {
  readonly referralCode?: string | undefined;
};

/**
 * The shared callback URL grammar: the exact expected origin and path, no
 * fragment, no repeated parameter, the expected share code as `ref` exactly
 * when one is expected, and otherwise either no query at all or precisely one
 * canonical UUIDv4 `attempt` parameter. Any other parameter name, count, or
 * shape fails closed.
 */
export const isExactCallbackUrlString = (
  rawUrl: string,
  baseOrigin: string,
  expectation: CallbackUrlExpectation = {}
): boolean => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.origin !== baseOrigin || url.pathname !== callbackPath) return false;
  if (url.hash !== "") return false;
  const entries = [...url.searchParams.entries()];
  const parameters = new Map(entries);
  if (parameters.size !== entries.length) return false;
  if (expectation.referralCode !== undefined) {
    if (parameters.get(referralParamName) !== expectation.referralCode)
      return false;
    parameters.delete(referralParamName);
  }
  if (parameters.size === 0) return true;
  if (parameters.size !== 1) return false;
  const [name, value] = [...parameters][0] as [string, string];
  return name === attemptParamName && canonicalUuidV4Pattern.test(value);
};

export const isExactCallbackUrl = (
  page: Playwright.Page,
  baseOrigin: string,
  expectation: CallbackUrlExpectation = {}
): boolean => {
  try {
    return isExactCallbackUrlString(page.url(), baseOrigin, expectation);
  } catch {
    return false;
  }
};

/**
 * The consumed-link failure grammar: the query of the URL Better Auth lands on
 * when a magic link cannot be verified. The callback URL is the redirect
 * target verbatim, so the failure parameter rides alongside whatever the
 * return-window coordination appended — either nothing (plain sign-in links)
 * or exactly one canonical `attempt` parameter. Any other parameter name,
 * count, or shape fails closed.
 */
export const isCallbackFailureQuery = (search: string): boolean => {
  let entries: [string, string][];
  try {
    entries = [...new URLSearchParams(search).entries()];
  } catch {
    return false;
  }
  const parameters = new Map(entries);
  if (parameters.size !== entries.length) return false;
  if (parameters.get(failureParamName) !== invalidTokenFailureValue)
    return false;
  parameters.delete(failureParamName);
  if (parameters.size === 0) return true;
  if (parameters.size !== 1) return false;
  const [name, value] = [...parameters][0] as [string, string];
  return name === attemptParamName && canonicalUuidV4Pattern.test(value);
};
