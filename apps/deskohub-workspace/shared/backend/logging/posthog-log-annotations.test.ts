import { describe, expect, test } from "bun:test";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import {
  getPostHogLogAnnotationsFromCookieHeader,
  getPostHogLogAnnotationsFromRequestHeaders,
} from "./posthog-log-annotations";

const analyticsConsentCookie = `cc_cookie=${encodeURIComponent(
  JSON.stringify({ categories: ["necessary", "analytics"] })
)}`;
const necessaryConsentCookie = `cc_cookie=${encodeURIComponent(
  JSON.stringify({ categories: ["necessary"] })
)}`;

describe("PostHog log annotations", () => {
  test("parses first-party PostHog cookies from a request cookie header", () => {
    expect(
      getPostHogLogAnnotationsFromCookieHeader(
        `other=ignored; ${POSTHOG_DISTINCT_ID_COOKIE}=user%20id; ${POSTHOG_SESSION_ID_COOKIE}=session%2Fid`
      )
    ).toEqual({
      posthogDistinctId: "user id",
      sessionId: "session/id",
    });
  });

  test("ignores invalid empty PostHog cookie identifiers", () => {
    expect(
      getPostHogLogAnnotationsFromCookieHeader(
        `${POSTHOG_DISTINCT_ID_COOKIE}=; ${POSTHOG_SESSION_ID_COOKIE}=`
      )
    ).toEqual({});
  });

  test("ignores PostHog tracing headers without first-party cookies", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          cookie: analyticsConsentCookie,
          "X-POSTHOG-DISTINCT-ID": "header-distinct-id",
          "X-POSTHOG-SESSION-ID": "header-session-id",
        })
      )
    ).toEqual({});
  });

  test("uses cookies as fallback when tracing headers are absent", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=cookie-session-id`,
        })
      )
    ).toEqual({
      posthogDistinctId: "cookie-distinct-id",
      sessionId: "cookie-session-id",
    });
  });

  test("uses cookies as fallback when tracing header identifiers are empty", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=cookie-session-id`,
          "X-POSTHOG-DISTINCT-ID": "",
          "X-POSTHOG-SESSION-ID": "",
        })
      )
    ).toEqual({
      posthogDistinctId: "cookie-distinct-id",
      sessionId: "cookie-session-id",
    });
  });

  test("prefers tracing headers over cookies", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=cookie-session-id`,
          "X-POSTHOG-DISTINCT-ID": "header-distinct-id",
          "X-POSTHOG-SESSION-ID": "header-session-id",
        })
      )
    ).toEqual({
      posthogDistinctId: "header-distinct-id",
      sessionId: "header-session-id",
    });
  });

  test("ignores request annotations without analytics consent", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          cookie: `${necessaryConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=cookie-session-id`,
          "X-POSTHOG-DISTINCT-ID": "header-distinct-id",
          "X-POSTHOG-SESSION-ID": "header-session-id",
        })
      )
    ).toEqual({});
  });

  test("ignores request annotations when any duplicate consent cookie revokes analytics", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          cookie: `${analyticsConsentCookie}; ${necessaryConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=cookie-session-id`,
          "X-POSTHOG-DISTINCT-ID": "header-distinct-id",
          "X-POSTHOG-SESSION-ID": "header-session-id",
        })
      )
    ).toEqual({});
  });
});
