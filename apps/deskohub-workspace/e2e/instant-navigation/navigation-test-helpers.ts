import {
  type BrowserContext,
  expect,
  type Page,
  type Request,
} from "@playwright/test";

export async function enablePreviewAccess(
  context: BrowserContext,
  baseURL: string | undefined
) {
  const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!previewBypassSecret) return;

  const response = await context.request.get(
    new URL("/favicon.svg", requireBaseUrl(baseURL)).toString(),
    {
      headers: {
        "x-vercel-protection-bypass": previewBypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
    }
  );
  expect(response.ok()).toBe(true);
  await response.dispose();
}

export async function expectPublicSiteShell(page: Page) {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" })
  ).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
}

export async function hasLoadedResource(page: Page, pathname: string) {
  return page.evaluate((targetPathname) => {
    return performance.getEntriesByType("resource").some((entry) => {
      try {
        return (
          new URL(entry.name, window.location.href).pathname === targetPathname
        );
      } catch {
        return false;
      }
    });
  }, pathname);
}

/**
 * Prefetches a route through the App Router and waits for the whole prefetch.
 * The router fetches the route tree before the segments it needs, so a loaded
 * tree alone does not mean an instant navigation can render the cached shell.
 * A route whose segments were already prefetched may issue no new requests.
 */
export async function prefetchRoute(page: Page, pathname: string) {
  const alreadyLoaded = await hasLoadedResource(page, pathname);
  const pending = new Set<Request>();
  let segmentLoaded = false;
  const onRequest = (request: Request) => {
    if (
      new URL(request.url()).pathname === pathname &&
      request.headers()["next-router-prefetch"] !== undefined
    ) {
      pending.add(request);
    }
  };
  const onSettled = (request: Request) => {
    if (!pending.delete(request)) return;
    const segment = request.headers()["next-router-segment-prefetch"];
    if (segment !== undefined && segment !== "/_tree") segmentLoaded = true;
  };

  page.on("request", onRequest);
  page.on("requestfinished", onSettled);
  page.on("requestfailed", onSettled);
  try {
    await page.waitForFunction(() => window.next?.router !== undefined);
    await page.evaluate(
      (target) => window.next?.router?.prefetch(target),
      pathname
    );
    await expect
      .poll(() => pending.size === 0 && (alreadyLoaded || segmentLoaded))
      .toBe(true);
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onSettled);
    page.off("requestfailed", onSettled);
  }
}

export function requireBaseUrl(baseURL: string | undefined) {
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for instant navigation");
  }

  return baseURL;
}
