import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Option } from "effect";
import { nativeReturnUri } from "./auth-callback";
import {
  nativeHandoffRequestTtlMs,
  nativeSignInUrl,
  readNativeHandoffRequest,
  restoreNativeHandoffRequest,
  serializeNativeHandoffRequest,
  withoutCallbackCredentials,
  withoutNativeRequestParams,
} from "./native-handoff-request";

const origin = "https://workspace.deskohub.cz";
const codeChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const state = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const request = {
  codeChallenge,
  state,
  returnUri: nativeReturnUri,
  reauthenticate: false,
  locale: "cs-CZ",
} as const;

const searchOf = (url: string) => new URL(url).searchParams;

// Kept byte for byte, so this instant's own spelling (offset, no fraction).
const decidedAt = "2026-11-02T10:30:00+01:00";
const granted = { granted: true, decidedAt } as const;
const denied = { granted: false, decidedAt } as const;

describe("native sign-in URL", () => {
  test("round-trips through the web page's reader", () => {
    const url = nativeSignInUrl(origin, request);
    expect(new URL(url).pathname).toBe("/app/sign-in");
    expect(readNativeHandoffRequest(searchOf(url), origin)).toEqual(
      Option.some(request)
    );
  });

  test("carries the reauthentication prompt", () => {
    const url = nativeSignInUrl(origin, { ...request, reauthenticate: true });
    expect(searchOf(url).get("prompt")).toBe("login");
    expect(readNativeHandoffRequest(searchOf(url), origin)).toEqual(
      Option.some({ ...request, reauthenticate: true })
    );
  });

  test("names the account a reauthentication signs in as, and why", () => {
    const reauthentication = {
      ...request,
      reauthenticate: true,
      loginHint: testEmailAddress("customer"),
      purpose: "delete-account",
    } as const;
    const url = nativeSignInUrl(origin, reauthentication);
    expect(searchOf(url).getAll("login_hint")).toEqual([
      testEmailAddress("customer"),
    ]);
    expect(searchOf(url).getAll("purpose")).toEqual(["delete-account"]);
    expect(readNativeHandoffRequest(searchOf(url), origin)).toEqual(
      Option.some(reauthentication)
    );
  });

  test("names the app's locale for the page, its email and a new account", () => {
    for (const locale of ["cs-CZ", "en-US"] as const) {
      const url = nativeSignInUrl(origin, { ...request, locale });
      expect(searchOf(url).getAll("locale")).toEqual([locale]);
      expect(readNativeHandoffRequest(searchOf(url), origin)).toEqual(
        Option.some({ ...request, locale })
      );
    }
  });
});

describe("native sign-in URL's analytics answer", () => {
  test("round-trips each answer with its decision time unchanged", () => {
    for (const analytics of [granted, denied]) {
      const url = nativeSignInUrl(origin, { ...request, analytics });
      expect(searchOf(url).getAll("analytics_decided_at")).toEqual([decidedAt]);
      expect(readNativeHandoffRequest(searchOf(url), origin)).toEqual(
        Option.some({ ...request, analytics })
      );
    }
    expect(
      searchOf(nativeSignInUrl(origin, { ...request, analytics: granted })).get(
        "analytics"
      )
    ).toBe("granted");
    expect(
      searchOf(nativeSignInUrl(origin, { ...request, analytics: denied })).get(
        "analytics"
      )
    ).toBe("denied");
  });

  test("carries no answer when the app holds none", () => {
    const search = searchOf(nativeSignInUrl(origin, request));
    expect(search.has("analytics")).toBe(false);
    expect(search.has("analytics_decided_at")).toBe(false);
  });
});

describe("readNativeHandoffRequest", () => {
  const valid = () =>
    new URLSearchParams({
      native: "1",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      return_uri: nativeReturnUri,
      locale: "cs-CZ",
    });

  test("ignores a page opened without native=1", () => {
    const search = valid();
    search.delete("native");
    expect(readNativeHandoffRequest(search, origin)).toEqual(Option.none());
  });

  test("accepts the site's own https callback as the return URI", () => {
    const search = valid();
    search.set("return_uri", `${origin}/app/auth/callback`);
    expect(readNativeHandoffRequest(search, origin)).toEqual(
      Option.some({ ...request, returnUri: `${origin}/app/auth/callback` })
    );
  });

  test("refuses another return URI", () => {
    for (const returnUri of [
      "https://evil.test/app/auth/callback",
      `${origin}/app/auth/callback?x=1`,
      "deskohub://account",
      "evil://auth/callback",
    ]) {
      const search = valid();
      search.set("return_uri", returnUri);
      expect(readNativeHandoffRequest(search, origin)).toEqual(Option.none());
    }
  });

  test("refuses a malformed challenge, method or state", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["code_challenge", codeChallenge.slice(1)],
      ["code_challenge", `${codeChallenge.slice(1)}=`],
      ["code_challenge_method", "plain"],
      ["state", "short"],
      ["state", `${state.slice(1)}+`],
      ["state", "a".repeat(513)],
    ];
    for (const [name, value] of cases) {
      const search = valid();
      search.set(name, value);
      expect(readNativeHandoffRequest(search, origin)).toEqual(Option.none());
    }
  });

  test("leaves the locale to the browser when an older app names none", () => {
    const search = valid();
    search.delete("locale");
    const { locale: _, ...withoutLocale } = request;
    expect(readNativeHandoffRequest(search, origin)).toEqual(
      Option.some(withoutLocale)
    );
  });

  test("ignores a locale the app doesn't support, or more than one", () => {
    const { locale: _, ...withoutLocale } = request;
    for (const locales of [["fr-FR"], ["cs"], [""], ["cs-CZ", "en-US"]]) {
      const search = valid();
      search.delete("locale");
      for (const locale of locales) search.append("locale", locale);
      expect(readNativeHandoffRequest(search, origin)).toEqual(
        Option.some(withoutLocale)
      );
    }
  });

  test("ignores a malformed or repeated login hint", () => {
    for (const hints of [
      ["not-an-email"],
      [testEmailAddress("a b")],
      [testEmailAddress("a".repeat(250))],
      [testEmailAddress("one"), testEmailAddress("two")],
    ]) {
      const search = valid();
      search.set("prompt", "login");
      for (const hint of hints) search.append("login_hint", hint);
      expect(readNativeHandoffRequest(search, origin)).toEqual(
        Option.some({ ...request, reauthenticate: true })
      );
    }
  });

  test("ignores a purpose the page doesn't know, or more than one", () => {
    for (const purposes of [
      ["close-account"],
      ["delete-account", "delete-account"],
    ]) {
      const search = valid();
      search.set("prompt", "login");
      for (const purpose of purposes) search.append("purpose", purpose);
      expect(readNativeHandoffRequest(search, origin)).toEqual(
        Option.some({ ...request, reauthenticate: true })
      );
    }
  });

  test("drops an invalid, duplicated or half analytics answer and keeps the request", () => {
    const cases: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [
      [["analytics", "granted"]],
      [["analytics_decided_at", decidedAt]],
      [
        ["analytics", "yes"],
        ["analytics_decided_at", decidedAt],
      ],
      [
        ["analytics", ""],
        ["analytics_decided_at", decidedAt],
      ],
      [
        ["analytics", "granted"],
        ["analytics_decided_at", "2026-11-02"],
      ],
      [
        ["analytics", "granted"],
        ["analytics_decided_at", "2026-11-02T10:30:00"],
      ],
      [
        ["analytics", "granted"],
        ["analytics_decided_at", ""],
      ],
      [
        ["analytics", "granted"],
        ["analytics", "granted"],
        ["analytics_decided_at", decidedAt],
      ],
      [
        ["analytics", "granted"],
        ["analytics", "denied"],
        ["analytics_decided_at", decidedAt],
      ],
      [
        ["analytics", "denied"],
        ["analytics_decided_at", decidedAt],
        ["analytics_decided_at", decidedAt],
      ],
    ];
    for (const pairs of cases) {
      const search = valid();
      for (const [name, value] of pairs) search.append(name, value);
      expect(readNativeHandoffRequest(search, origin)).toEqual(
        Option.some(request)
      );
    }
  });

  test("refuses duplicated parameters", () => {
    const search = valid();
    search.append("state", state);
    expect(readNativeHandoffRequest(search, origin)).toEqual(Option.none());
  });
});

describe("stored native handoff request", () => {
  const now = Date.UTC(2026, 10, 7, 12);

  test("restores before it expires", () => {
    const raw = serializeNativeHandoffRequest(request, now);
    expect(
      restoreNativeHandoffRequest(raw, now + nativeHandoffRequestTtlMs - 1)
    ).toEqual(Option.some(request));
  });

  test("restores a request without a locale", () => {
    const { locale: _, ...withoutLocale } = request;
    const raw = serializeNativeHandoffRequest(withoutLocale, now);
    expect(restoreNativeHandoffRequest(raw, now)).toEqual(
      Option.some(withoutLocale)
    );
  });

  test("restores a reauthentication's login hint and purpose", () => {
    const reauthentication = {
      ...request,
      reauthenticate: true,
      loginHint: testEmailAddress("customer"),
      purpose: "delete-account",
    } as const;
    const raw = serializeNativeHandoffRequest(reauthentication, now);
    expect(restoreNativeHandoffRequest(raw, now)).toEqual(
      Option.some(reauthentication)
    );
  });

  test("restores the analytics answer with its decision time unchanged", () => {
    for (const analytics of [granted, denied]) {
      const raw = serializeNativeHandoffRequest({ ...request, analytics }, now);
      expect(restoreNativeHandoffRequest(raw, now)).toEqual(
        Option.some({ ...request, analytics })
      );
    }
  });

  test("drops a malformed stored analytics answer and keeps the request", () => {
    for (const analytics of [
      { granted: true },
      { granted: "true", decidedAt },
      { granted: true, decidedAt: "yesterday" },
      null,
    ]) {
      expect(
        restoreNativeHandoffRequest(
          JSON.stringify({
            request: { ...request, analytics },
            expiresAt: now + 1000,
          }),
          now
        )
      ).toEqual(Option.some(request));
    }
  });

  test("expires within ten minutes", () => {
    expect(nativeHandoffRequestTtlMs).toBeLessThanOrEqual(10 * 60 * 1000);
    const raw = serializeNativeHandoffRequest(request, now);
    expect(
      restoreNativeHandoffRequest(raw, now + nativeHandoffRequestTtlMs)
    ).toEqual(Option.none());
  });

  test("reads absent or malformed storage as none", () => {
    expect(restoreNativeHandoffRequest(null, now)).toEqual(Option.none());
    expect(restoreNativeHandoffRequest("{", now)).toEqual(Option.none());
    expect(
      restoreNativeHandoffRequest(
        JSON.stringify({ request: { state }, expiresAt: now + 1000 }),
        now
      )
    ).toEqual(Option.none());
    expect(
      restoreNativeHandoffRequest(
        JSON.stringify({
          request: { ...request, locale: "fr-FR" },
          expiresAt: now + 1000,
        }),
        now
      )
    ).toEqual(Option.none());
  });
});

describe("URL stripping", () => {
  test("drops the native request params and keeps the rest", () => {
    const url = `${nativeSignInUrl(origin, {
      ...request,
      reauthenticate: true,
      loginHint: testEmailAddress("customer"),
      purpose: "delete-account",
      analytics: granted,
    })}&lang=cs#top`;
    expect(withoutNativeRequestParams(url)).toBe("/app/sign-in?lang=cs#top");
  });

  test("drops callback credentials and keeps the path", () => {
    expect(
      withoutCallbackCredentials(
        `${origin}/app/auth/callback?token=t&code=c&state=s&error=e&utm=x`
      )
    ).toBe("/app/auth/callback?utm=x");
    expect(withoutCallbackCredentials(`${origin}/app/auth/callback`)).toBe(
      "/app/auth/callback"
    );
  });
});
