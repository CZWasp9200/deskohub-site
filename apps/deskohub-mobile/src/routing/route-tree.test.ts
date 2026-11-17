import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  accountSectionHref,
  accountSectionOrder,
} from "../account/account-gating";
import {
  onboardingBillingHref,
  onboardingHref,
} from "../account/onboarding/onboarding-routes";
import { screenPathPattern } from "../analytics/screen-path";
import {
  bookCheckoutHref,
  bookFamilyHref,
  bookProfileHref,
  paymentStatusHref,
  reservationsHref,
} from "../booking/booking-routes";
import { appLinkRoute } from "./app-link";
import { startTabHref } from "./start-tab";

const appDir = join(import.meta.dir, "../../app");

/** Every route file under app/, as segments relative to it, without the extension. */
const routeFiles = () =>
  readdirSync(appDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) =>
      relative(appDir, join(entry.parentPath, entry.name))
        .replace(/\.tsx?$/, "")
        .split(sep)
    );

/** Screens, without layouts and Expo Router's `+` files such as `+native-intent`. */
const screens = () =>
  routeFiles().filter(
    (segments) =>
      segments.at(-1) !== "_layout" && !segments.at(-1)?.startsWith("+")
  );

/** Whether a link's path names a screen, matching dynamic segments to any one segment. */
const resolves = (link: string) => {
  const route = appLinkRoute(link).replace(/^deskohub:\/\//, "/");
  const path = route.split(/[?#]/)[0]?.replace(/\/$/, "") || "/";
  return screens()
    .map(screenPathPattern)
    .some((pattern) =>
      new RegExp(`^${pattern.replace(/\[[^\]/]+\]/g, "[^/]+")}$`).test(path)
    );
};

const layouts = () =>
  routeFiles()
    .filter((segments) => segments.at(-1) === "_layout")
    .map((segments) => segments.slice(0, -1).join("/"));

describe("app route tree", () => {
  test("groups keep every screen's URL", () => {
    const urls = screens().map(screenPathPattern).sort();
    expect(urls).toEqual(
      [
        "/",
        "/account",
        "/account-deleted",
        "/account/assistants",
        "/account/billing",
        "/account/danger",
        "/account/invoices",
        "/account/language",
        "/account/legal",
        "/account/profile",
        "/account/referrals",
        "/account/security",
        "/auth/callback",
        "/book",
        "/book/checkout",
        "/book/cowork",
        "/book/meeting-room",
        "/book/office",
        "/book/profile",
        "/dev/booking-components",
        "/dev/design-system",
        "/dev/effect-smoke",
        "/dev/reservations",
        "/onboarding",
        "/onboarding/billing",
        "/onboarding/done",
        "/reservations",
        "/reservations/[orderId]",
        "/reservations/[orderId]/access",
        "/sign-in",
      ].sort()
    );
  });

  test("the signed-in group and the tabs each have a layout file", () => {
    expect(layouts()).toContain("(account)");
    expect(layouts()).toContain("(account)/(tabs)");
  });

  test("a paid booking's status sits in the Reservations tab, outside the book stack its checkout lives in", () => {
    // Back from the status (paid, or paid again from its ticket) can only
    // reach the Reservations list: the checkout's stack is dismissed first.
    const matching = (path: string) =>
      screens()
        .map((segments) => segments.join("/"))
        .filter((screen) =>
          new RegExp(
            `^${screenPathPattern(screen.split("/")).replace(/\[[^\]/]+\]/g, "[^/]+")}$`
          ).test(path)
        );
    const status = paymentStatusHref("order-1").split("?")[0] ?? "";
    expect(matching(status)).toEqual([
      "(account)/(tabs)/reservations/[orderId]/index",
    ]);
    expect(matching(bookCheckoutHref)).toEqual(["(account)/book/checkout"]);
  });

  test("the Book tab holds only the choice of spaces; booking opens above the tabs", () => {
    const screensIn = (prefix: string) =>
      screens()
        .map((segments) => segments.join("/"))
        .filter((path) => path.startsWith(prefix));
    expect(screensIn("(account)/(tabs)/book/")).toEqual([
      "(account)/(tabs)/book/index",
    ]);
    expect(screensIn("(account)/book/").sort()).toEqual([
      "(account)/book/checkout",
      "(account)/book/cowork",
      "(account)/book/meeting-room",
      "(account)/book/office",
      "(account)/book/profile",
    ]);
  });

  test("onboarding opens above the tabs, over the tab that asked for it", () => {
    const paths = screens().map((segments) => segments.join("/"));
    expect(
      paths.filter((path) => path.startsWith("(account)/onboarding/")).sort()
    ).toEqual([
      "(account)/onboarding/billing",
      "(account)/onboarding/done",
      "(account)/onboarding/index",
    ]);
    expect(layouts()).toContain("(account)/onboarding");
    expect(
      paths.filter(
        (path) =>
          path.startsWith("(account)/(tabs)/") && path.includes("complete")
      )
    ).toEqual([]);
  });

  test("onboarding's links and finish actions name a screen", () => {
    for (const href of [
      accountSectionHref.complete,
      onboardingHref,
      onboardingBillingHref,
      startTabHref.book,
      startTabHref.reservations,
    ]) {
      expect({ href, resolves: resolves(href) }).toEqual({
        href,
        resolves: true,
      });
    }
  });

  test("a reservation's access PIN opens above the tabs, under the same URL", () => {
    const paths = screens().map((segments) => segments.join("/"));
    expect(paths).toContain("(account)/reservations/[orderId]/access");
    expect(
      paths.filter((path) => path.startsWith("(account)/(tabs)/reservations/"))
    ).toEqual(
      expect.arrayContaining([
        "(account)/(tabs)/reservations/index",
        "(account)/(tabs)/reservations/[orderId]/index",
      ])
    );
    expect(
      paths.filter((path) => path.startsWith("(account)/(tabs)/reservations/"))
    ).not.toContain("(account)/(tabs)/reservations/[orderId]/access");
  });

  test("Back from an access PIN a link opened alone lands on the Reservations tab's list", () => {
    // The PIN stacks above the tabs, so a cold start from its link has
    // nothing behind it; its header's back fallback opens the list instead.
    const paths = screens().map((segments) => segments.join("/"));
    expect(
      paths.filter(
        (path) =>
          screenPathPattern(path.split("/")) === reservationsHref &&
          path.startsWith("(account)/")
      )
    ).toEqual(["(account)/(tabs)/reservations/index"]);
  });

  test("the start-tab redirect sits in the signed-in group, where the account's data is", () => {
    expect(screens().map((segments) => segments.join("/"))).toContain(
      "(account)/index"
    );
  });

  test("only the tab stacks sit inside the tabs", () => {
    // A hidden tab (`href: null`) that gains focus is redirected to the
    // initial tab, so screens outside the tab bar, such as booking a space
    // and its checkout, belong to the signed-in stack beside `(tabs)`.
    const tabs = readdirSync(join(appDir, "(account)", "(tabs)"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(tabs).toEqual(["account", "book", "reservations"]);
  });

  test("app and web link paths match a screen's route pattern", () => {
    for (const link of [
      "deskohub://reservations/synthetic-order?after=payment",
      "deskohub://account/legal",
      "https://workspace.deskohub.cz/app/reservations/synthetic-order?after=payment",
      "https://workspace.deskohub.cz/app/account/legal",
      "https://workspace.deskohub.cz/app/account",
      "/reservations/synthetic-order/access",
    ]) {
      expect({ link, resolves: resolves(link) }).toEqual({
        link,
        resolves: true,
      });
    }
    expect(resolves("deskohub://no-such-screen")).toBe(false);
  });

  test("booking's links name a screen", () => {
    for (const href of [
      "/book",
      bookFamilyHref("cowork"),
      bookFamilyHref("meeting-room"),
      bookFamilyHref("office", "quote_expired"),
      bookCheckoutHref,
      bookProfileHref,
      reservationsHref,
      paymentStatusHref("synthetic-order"),
    ]) {
      expect({ href, resolves: resolves(href) }).toEqual({
        href,
        resolves: true,
      });
    }
  });

  test("every Account section with a screen links to it", () => {
    for (const section of accountSectionOrder) {
      // Payment methods has no screen yet; its row only shows.
      if (section === "payment-methods") continue;
      const href = accountSectionHref[section];
      expect({ section, resolves: resolves(href) }).toEqual({
        section,
        resolves: true,
      });
    }
  });
});
