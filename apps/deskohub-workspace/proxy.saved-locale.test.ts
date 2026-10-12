import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { NextRequest } from "next/server";
import { localeCookieName } from "@/features/i18n/routing";
import { getReservationAccessCookieName } from "@/features/reservation/backend/reservation-access-cookie";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenQueryParam } from "@/features/reservation/reservation-access-token";

const signedInCookie = "better-auth.session_token=synthetic-token.signature";
let savedPreference: "cs-CZ" | "en-US" | undefined;
const preferenceReads: string[] = [];

mock.module("@/features/account/server/saved-locale-preference.server", () => ({
  readSavedLocalePreference: (headers: Pick<Headers, "get">) => {
    const cookie = headers.get("cookie") ?? "";
    preferenceReads.push(cookie);
    return Promise.resolve(
      cookie.includes("session_token=") ? savedPreference : undefined
    );
  },
}));

const { proxy } = await import("./proxy");

beforeEach(() => {
  savedPreference = "cs-CZ";
  preferenceReads.length = 0;
});

const request = (
  path: string,
  { cookie, headers }: { cookie?: string; headers?: HeadersInit } = {}
) => {
  const requestHeaders = new Headers(headers);
  if (cookie) requestHeaders.set("cookie", cookie);
  return new NextRequest(`https://workspace.example${path}`, {
    headers: requestHeaders,
  });
};

describe("signed-in customer's saved language preference", () => {
  test("outranks a conflicting URL, cookie, and Accept-Language with a redirect", async () => {
    const response = await proxy(
      request("/en-US/gallery?photo=2", {
        cookie: `${signedInCookie}; ${localeCookieName}=en-US`,
        headers: { "accept-language": "en-US,en;q=0.9" },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/gallery?photo=2"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.cookies.get(localeCookieName)?.value).toBe("cs-CZ");
  });

  test("lets a matching URL through and keeps the cookie on the preference", async () => {
    const response = await proxy(
      request("/cs-CZ/gallery", {
        cookie: `${signedInCookie}; ${localeCookieName}=en-US`,
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get(localeCookieName)?.value).toBe("cs-CZ");
  });

  test("localizes an unprefixed URL to the preference over the cookie", async () => {
    const response = await proxy(
      request("/gallery", {
        cookie: `${signedInCookie}; ${localeCookieName}=en-US`,
      })
    );

    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/gallery"
    );
  });

  test("leaves a signed-in account without a saved preference on the guest chain", async () => {
    savedPreference = undefined;

    const response = await proxy(
      request("/en-US/gallery", {
        cookie: `${signedInCookie}; ${localeCookieName}=cs-CZ`,
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get(localeCookieName)?.value).toBe("en-US");
  });

  test("exchanges a reservation capability in its issuance locale before applying the preference", async () => {
    const orderId = workspaceReservationIdSchema.make("reservation-id");
    const accessToken = Effect.runSync(
      createReservationAccessToken({ orderId, locale: "en-US" })
    );

    const exchange = await proxy(
      request(
        `/en-US/reservation/access/${orderId}?${reservationAccessTokenQueryParam}=${encodeURIComponent(accessToken)}`,
        { cookie: signedInCookie }
      )
    );

    expect(exchange.headers.get("location")).toBe(
      `https://workspace.example/en-US/reservation/access/${orderId}`
    );
    expect(
      exchange.cookies.get(getReservationAccessCookieName(orderId))?.value
    ).toEqual(expect.any(String));

    const cleanRequest = await proxy(
      request(`/en-US/reservation/access/${orderId}`, {
        cookie: signedInCookie,
      })
    );
    expect(cleanRequest.headers.get("location")).toBe(
      `https://workspace.example/cs-CZ/reservation/access/${orderId}`
    );
  });

  test("does not read the preference for router prefetches", async () => {
    const response = await proxy(
      request("/en-US/gallery", {
        cookie: signedInCookie,
        headers: { rsc: "1", "next-router-prefetch": "1" },
      })
    );

    expect(preferenceReads).toEqual([]);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("guest locale chain", () => {
  test("keeps the URL above the cookie without reading a preference", async () => {
    const response = await proxy(
      request("/en-US/gallery", { cookie: `${localeCookieName}=cs-CZ` })
    );

    expect(preferenceReads).toEqual([]);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get(localeCookieName)?.value).toBe("en-US");
  });

  test("localizes an unprefixed URL from the cookie, then Accept-Language", async () => {
    const fromCookie = await proxy(
      request("/gallery", {
        cookie: `${localeCookieName}=cs-CZ`,
        headers: { "accept-language": "en-US" },
      })
    );
    const fromAcceptLanguage = await proxy(
      request("/gallery", { headers: { "accept-language": "cs" } })
    );

    expect(fromCookie.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/gallery"
    );
    expect(fromAcceptLanguage.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/gallery"
    );
  });
});
