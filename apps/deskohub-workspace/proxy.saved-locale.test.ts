import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { NextRequest } from "next/server";
import { sealSyntheticCoworkPayState } from "@/features/checkout/backend/checkout/pay-state.test-utils";
import { payStateTokenQueryParam } from "@/features/checkout/pay-state-token-query";
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

  const invoiceOrderId = workspaceReservationIdSchema.make("reservation-id");
  const invoiceToken = (locale: "cs-CZ" | "en-US", orderId = invoiceOrderId) =>
    encodeURIComponent(
      Effect.runSync(createReservationAccessToken({ orderId, locale }))
    );
  const payState = async (
    options: Parameters<typeof sealSyntheticCoworkPayState>[0]
  ) => encodeURIComponent(await sealSyntheticCoworkPayState(options));
  const expectKeptInEnglish = (response: Response) => {
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  };
  const expectMovedToCzech = (response: Response) =>
    expect(response.headers.get("location")).toStartWith(
      "https://workspace.example/cs-CZ/"
    );

  test("keeps a validly signed en-US invoice link in its issued locale for a cs-CZ owner", async () => {
    const response = await proxy(
      request(
        `/en-US/reservation/invoice/${invoiceOrderId}?${reservationAccessTokenQueryParam}=${invoiceToken("en-US")}`,
        { cookie: signedInCookie }
      )
    );

    expectKeptInEnglish(response);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("keeps a validly signed en-US Pay state in its issued locale for a cs-CZ customer", async () => {
    const token = await payState({ locale: "en-US" });
    for (const path of [
      `/en-US/checkout/pay?${payStateTokenQueryParam}=${token}`,
      `/en-US/reservation/cowork?${payStateTokenQueryParam}=${token}`,
    ]) {
      expectKeptInEnglish(
        await proxy(request(path, { cookie: signedInCookie }))
      );
    }
  });

  test("redirects an invalid, expired, wrong-family or wrong-locale Pay state to the preference", async () => {
    const expired = await payState({
      locale: "en-US",
      issuedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const coworkState = await payState({ locale: "en-US" });
    const czechState = await payState({ locale: "cs-CZ" });
    for (const path of [
      `/en-US/reservation/cowork?${payStateTokenQueryParam}=garbage`,
      `/en-US/checkout/pay?${payStateTokenQueryParam}=${expired}`,
      `/en-US/reservation/office?${payStateTokenQueryParam}=${coworkState}`,
      `/en-US/reservation/meeting-room?${payStateTokenQueryParam}=${coworkState}`,
      `/en-US/checkout/pay?${payStateTokenQueryParam}=${czechState}`,
    ]) {
      expectMovedToCzech(
        await proxy(request(path, { cookie: signedInCookie }))
      );
    }
  });

  test("redirects an invalid, wrong-order or wrong-locale invoice token to the preference", async () => {
    const otherOrder = workspaceReservationIdSchema.make("other-reservation");
    for (const token of [
      "synthetic-token",
      invoiceToken("en-US", otherOrder),
      invoiceToken("cs-CZ"),
    ]) {
      expectMovedToCzech(
        await proxy(
          request(
            `/en-US/reservation/invoice/${invoiceOrderId}?${reservationAccessTokenQueryParam}=${token}`,
            { cookie: signedInCookie }
          )
        )
      );
    }
  });

  test("redirects a continuation parameter on a route it does not belong to", async () => {
    for (const path of [
      `/en-US/gallery?${reservationAccessTokenQueryParam}=synthetic-token`,
      `/en-US/gallery?${payStateTokenQueryParam}=synthetic-state`,
      `/en-US/reservation/invoice/reservation-id?${payStateTokenQueryParam}=synthetic-state`,
      `/en-US/checkout/pay?${reservationAccessTokenQueryParam}=synthetic-token`,
      `/en-US/checkout/pay/return/reservation-id?${payStateTokenQueryParam}=synthetic-state`,
    ]) {
      const response = await proxy(request(path, { cookie: signedInCookie }));

      expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
        new URL(`https://workspace.example${path}`).pathname.replace(
          "/en-US",
          "/cs-CZ"
        )
      );
    }
  });

  test("redirects a supported continuation route whose value is empty", async () => {
    for (const path of [
      `/en-US/reservation/invoice/reservation-id?${reservationAccessTokenQueryParam}=`,
      `/en-US/checkout/pay?${payStateTokenQueryParam}=`,
      `/en-US/reservation/office?${payStateTokenQueryParam}=%20`,
    ]) {
      const response = await proxy(request(path, { cookie: signedInCookie }));

      expect(response.headers.get("location")).toStartWith(
        "https://workspace.example/cs-CZ/"
      );
    }
  });

  test("still applies the preference to the same pages without a continuation", async () => {
    const response = await proxy(
      request("/en-US/reservation/cowork", { cookie: signedInCookie })
    );

    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/reservation/cowork"
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
