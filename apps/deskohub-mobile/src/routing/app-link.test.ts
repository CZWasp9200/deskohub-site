import { describe, expect, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { appLinkRoute } from "./app-link";

describe("appLinkRoute", () => {
  test("routes a sign-in App Link to the callback route with its query", () => {
    expect(
      appLinkRoute(
        "https://workspace.deskohub.cz/app/auth/callback?token=synthetic-token"
      )
    ).toBe("/auth/callback?token=synthetic-token");
  });

  test("routes the web app's root to the app's root", () => {
    expect(appLinkRoute("https://workspace.deskohub.cz/app")).toBe("/");
    expect(appLinkRoute("https://workspace.deskohub.cz/app/")).toBe("/");
  });

  test("keeps a hash", () => {
    expect(appLinkRoute("https://workspace.deskohub.cz/app/sign-in#top")).toBe(
      "/sign-in#top"
    );
  });

  test("leaves the app's own scheme and development links alone", () => {
    for (const path of [
      "deskohub://auth/callback?code=c&state=s",
      "exp+deskohub-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081",
      "/auth/callback?token=synthetic-token",
    ]) {
      expect(appLinkRoute(path)).toBe(path);
    }
  });

  test("leaves https links outside the web app and its claimed site pages alone", () => {
    for (const path of [
      "https://workspace.deskohub.cz/",
      "https://workspace.deskohub.cz/application",
      "https://workspace.deskohub.cz/cs/app/auth/callback",
      "https://workspace.deskohub.cz/en-US",
      "https://workspace.deskohub.cz/en-US/reservation/status/synthetic-order",
      "https://workspace.deskohub.cz/cs-CZ/reservation/cowork",
      "https://workspace.deskohub.cz/en-US/reservation/invoice/synthetic-order",
      "https://workspace.deskohub.cz/en-US/account/legal",
      "https://workspace.deskohub.cz/en-US/account/invoices/synthetic-invoice",
      "https://workspace.deskohub.cz/en-US/account/data-export",
      "https://workspace.deskohub.cz/en-US/auth/callback?token=synthetic-token",
      "https://workspace.deskohub.cz/en-US/contact",
      "https://workspace.deskohub.cz/xx-XX/account",
      "https://workspace.deskohub.cz/en-US/en-US/account",
    ]) {
      expect(appLinkRoute(path)).toBe(path);
    }
  });

  test("leaves an unparseable value alone", () => {
    expect(appLinkRoute("not a url")).toBe("not a url");
  });

  describe("website pages", () => {
    const origin = "https://workspace.deskohub.cz";
    const localePrefixes = ["", ...supportedLocales.map((tag) => `/${tag}`)];

    test("opens the email's access page on the reservation's PIN screen without its token", () => {
      expect(
        appLinkRoute(
          `${origin}/en-US/reservation/access/synthetic-order?accessToken=synthetic-access-token#pin`
        )
      ).toBe("/reservations/synthetic-order/access");
    });

    test("reads the access page with every locale tag and without one", () => {
      for (const prefix of localePrefixes) {
        expect(
          appLinkRoute(
            `${origin}${prefix}/reservation/access/synthetic-order?accessToken=synthetic-access-token`
          )
        ).toBe("/reservations/synthetic-order/access");
        expect(
          appLinkRoute(`${origin}${prefix}/reservation/access/synthetic-order/`)
        ).toBe("/reservations/synthetic-order/access");
      }
    });

    test("opens account pages on the matching app screens", () => {
      const routes = {
        "/account/reservations": "/reservations",
        "/account/referrals": "/account/referrals",
        "/account/profile": "/account/profile",
        "/account/security": "/account/security",
        "/account/assistants": "/account/assistants",
        "/account/billing": "/account/billing",
        "/account/danger": "/account/danger",
      };
      for (const prefix of localePrefixes) {
        for (const [page, route] of Object.entries(routes)) {
          expect(
            appLinkRoute(`${origin}${prefix}${page}?utm_source=email`)
          ).toBe(route);
        }
      }
    });

    // Website sign-in lands on the bare account page by default, so the app
    // leaves it to the browser and web sign-in stays on the website.
    test("leaves the bare account page to the browser", () => {
      for (const prefix of localePrefixes) {
        const url = `${origin}${prefix}/account`;
        expect(appLinkRoute(url)).toBe(url);
      }
    });

    test("opens the app's start for an access page it can't read", () => {
      for (const path of [
        "/en-US/reservation/access/",
        "/en-US/reservation/access/synthetic-order/extra",
        "/reservation/access/synthetic-order/extra/",
        "/cs-CZ/reservation/access//synthetic-order",
      ]) {
        expect(
          appLinkRoute(`${origin}${path}?accessToken=synthetic-access-token`)
        ).toBe("/");
      }
    });
  });
});
