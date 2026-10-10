import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";
import { captureAccountReview } from "../account/review-screenshots";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  enablePreviewAccess,
  expectPublicSiteShell,
  prefetchRoute,
  requireBaseUrl,
} from "./navigation-test-helpers";

const homePath = "/en-US";
const accountPath = "/en-US/account";
const signInPath = "/en-US/auth/sign-in";
const accountStatusName = "My account | Deskohub Workspace";
const signInHeading = "Sign in or create an account";
const signInLoadingName = "Loading sign-in…";

if (process.env.WORKSPACE_E2E_BASE_URL === undefined) {
  throw new Error(
    "WORKSPACE_E2E_BASE_URL must be configured for account navigation tests"
  );
}

type AccountNavigationOptions = {
  readonly verifySignInHandoff?: boolean;
};

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test.describe("client navigation", () => {
  test("links the anonymous header account button straight to sign-in", async ({
    page,
  }) => {
    await page.goto(homePath);
    await expectPublicSiteShell(page);

    const visitedPathnames: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        visitedPathnames.push(new URL(frame.url()).pathname);
      }
    });

    const accountLink = page
      .getByRole("banner")
      .getByRole("link", { name: "Account" });
    await expect(accountLink).toHaveAttribute("href", signInPath);
    await accountLink.click();

    await expectAnonymousSignIn(page);
    await expect(
      page.getByRole("status", { name: accountStatusName })
    ).toHaveCount(0);
    expect(visitedPathnames).not.toContain(accountPath);
  });

  test("streams the account loading shell before redirecting an anonymous client", async ({
    baseURL,
    page,
  }) => {
    await page.goto(homePath);
    await expectPublicSiteShell(page);

    await navigateToAccount(page, baseURL, { verifySignInHandoff: true });
    await expectAnonymousSignIn(page);

    await page
      .getByRole("banner")
      .getByRole("link", { name: "Deskohub Workspace" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${homePath}$`));
    await expectPublicSiteShell(page);

    await navigateToAccount(page, baseURL);
    await expectAnonymousSignIn(page);
  });
});

// The anonymous header links to sign-in, so this drives the App Router directly
// to cover a client navigation that still lands on the account route.
async function navigateToAccount(
  page: Page,
  baseURL: string | undefined,
  options: AccountNavigationOptions = {}
) {
  await prefetchRoute(page, accountPath);
  await page.evaluate((path) => {
    document.documentElement.dataset.navigationSource = path;
  }, homePath);

  const runAccountInstantFallback = async () => {
    await instant(
      page,
      async () => {
        await page.evaluate(
          (path) => window.next?.router?.push(path),
          accountPath
        );

        await expect(page).toHaveURL(new RegExp(`${accountPath}$`));
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.dataset.navigationSource
            )
          )
          .toBe(homePath);
        await expectPublicSiteShell(page);
        const status = page.getByRole("status", { name: accountStatusName });
        await expect(status).toBeVisible();
        await expect(status).not.toHaveAttribute("aria-busy", "true");
        const busyContent = status.locator('[aria-busy="true"]');
        await expect(busyContent).toHaveCount(1);
        await expect(busyContent).toBeVisible();
        await expect(
          busyContent.locator('[data-slot="skeleton"]').first()
        ).toBeVisible();
        await captureAccountReview(
          page,
          requireBaseUrl(baseURL),
          "account-loading-desktop"
        );
        await expect(
          page.getByRole("heading", { name: signInHeading })
        ).toHaveCount(0);
      },
      { baseURL: requireBaseUrl(baseURL) }
    );
  };

  if (options.verifySignInHandoff) {
    await withSignInHandoffEvidence(
      page,
      requireBaseUrl(baseURL),
      runAccountInstantFallback
    );
    return;
  }

  await runAccountInstantFallback();
}

async function withSignInHandoffEvidence(
  page: Page,
  baseUrl: string,
  runAccountInstantFallback: () => Promise<void>
) {
  const baseOrigin = new URL(baseUrl).origin;
  const signInHandoffRouteMatcher = (url: URL) =>
    url.origin === baseOrigin && url.pathname === signInPath;

  let resolveHandoffStarted!: () => void;
  const handoffStarted = new Promise<void>((resolve) => {
    resolveHandoffStarted = resolve;
  });
  let resolveOriginalRequest!: () => void;
  const originalRequestHold = new Promise<void>((resolve) => {
    resolveOriginalRequest = resolve;
  });
  let originalRequestReleased = false;
  const releaseOriginalRequest = () => {
    if (originalRequestReleased) return;
    originalRequestReleased = true;
    resolveOriginalRequest();
  };
  let handoffClaimed = false;
  let fullHandlerPromise: Promise<void> | undefined;
  const handleSignInHandoffRoute: Parameters<Page["route"]>[1] = (
    route,
    request
  ) => {
    const headers = request.headers();
    const isSignInHandoffRequest =
      request.method() === "GET" &&
      headers.rsc === "1" &&
      headers["next-router-prefetch"] !== "1" &&
      headers.purpose !== "prefetch";
    if (handoffClaimed || !isSignInHandoffRequest) {
      return route.continue();
    }

    handoffClaimed = true;
    fullHandlerPromise = (async () => {
      await originalRequestHold;
      await route.continue();
    })();
    resolveHandoffStarted();
    return fullHandlerPromise;
  };

  await page.route(signInHandoffRouteMatcher, handleSignInHandoffRoute);
  try {
    await runAccountInstantFallback();
    await waitForBoundedPromise(handoffStarted);

    const signInLoading = page.getByRole("status", {
      name: signInLoadingName,
    });
    await expect(signInLoading).toBeVisible({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(signInLoading).toHaveAttribute(
      "data-slot",
      "sign-in-loading",
      { timeout: workspaceE2ETimeouts.browserAction }
    );

    const layout = await page.evaluate(() => {
      const header = document.querySelector("header");
      const main = document.querySelector("main");
      const footer = document.querySelector("footer");
      if (!header || !main || !footer) return null;

      const headerRect = header.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        footerTop: footerRect.top,
        headerBottom: headerRect.bottom,
        mainBottom: mainRect.bottom,
        mainHeight: mainRect.height,
      };
    });
    if (!layout)
      throw new Error("Sign-in handoff layout landmarks are missing");
    expect(layout.mainHeight).toBeGreaterThan(0);
    expect(layout.footerTop).toBeGreaterThanOrEqual(layout.mainBottom);
    expect(layout.footerTop).toBeGreaterThanOrEqual(layout.headerBottom);

    await captureAccountReview(page, baseUrl, "sign-in-handoff-desktop");
  } finally {
    releaseOriginalRequest();
    try {
      if (fullHandlerPromise) await waitForBoundedPromise(fullHandlerPromise);
    } finally {
      await page.unroute(signInHandoffRouteMatcher, handleSignInHandoffRoute);
    }
  }
}

async function waitForBoundedPromise<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Sign-in handoff did not settle in time")),
          workspaceE2ETimeouts.browserAction
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function expectAnonymousSignIn(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${signInPath}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: signInHeading })
  ).toBeVisible();
}
