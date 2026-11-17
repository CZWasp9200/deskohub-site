import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { githubMobileRelease } from "@/features/mobile-releases/android-release.test-utils";
import { fakeGitHubApi } from "@/features/mobile-releases/backend/github-api.test-utils";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

// Outside a Next.js render there is no cache; each lookup runs.
const nextCacheModule = await import("next/cache");
const nextCache = recordNextCache();
mock.module("next/cache", () => ({ ...nextCacheModule, ...nextCache.module }));

const { GET: getLatest } = await import("./route");
const { GET: getFile } = await import("./[file]/route");

// Effect reads the global `fetch` once, on the first request, so one stub
// stays installed and serves whichever fake GitHub API the test set up.
const originalFetch = globalThis.fetch;
let github = fakeGitHubApi({});
globalThis.fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => github.fetch(input, init),
  { preconnect: originalFetch.preconnect }
);
const serveGitHub = (routes: Parameters<typeof fakeGitHubApi>[0]) => {
  github = fakeGitHubApi(routes);
  return github;
};

beforeEach(() => nextCache.clear());
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const origin = "https://workspace.example";
const downloadLatest = () =>
  getLatest(new Request(`${origin}/android/download`), {
    params: Promise.resolve({}),
  });
const downloadFile = (file: string) =>
  getFile(new Request(`${origin}/android/download/${file}`), {
    params: Promise.resolve({ file }),
  });

const assetUrl = (version: string) =>
  githubMobileRelease(version).assets.find(
    (asset) => asset.name === `deskohub-${version}.apk`
  )?.browser_download_url;

const releasePath = (version: string) => `/releases/tags/mobile-v${version}`;
const releasesApiPath = (version: string) =>
  `/repos/totalolage/deskohub-site${releasePath(version)}`;

/** GitHub with releases 1.2.2 and 1.2.3, and a tag 1.2.1 with no release. */
const serveReleases = () =>
  serveGitHub({
    "/git/matching-refs/tags/mobile-v": () =>
      Response.json(
        ["1.2.1", "1.2.2", "1.2.3"].map((version) => ({
          ref: `refs/tags/mobile-v${version}`,
        }))
      ),
    [releasePath("1.2.2")]: () => Response.json(githubMobileRelease("1.2.2")),
    [releasePath("1.2.3")]: () => Response.json(githubMobileRelease("1.2.3")),
  });

describe("GET /android/download", () => {
  test("redirects to the latest release's APK on GitHub", async () => {
    serveReleases();

    const response = await downloadLatest();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(assetUrl("1.2.3"));
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=600");
  });

  test("answers 404 before the first release", async () => {
    serveGitHub({
      "/git/matching-refs/tags/mobile-v": () => Response.json([]),
    });

    const response = await downloadLatest();

    expect(response.status).toBe(404);
    expect(response.headers.get("Location")).toBeNull();
  });

  test("answers an uncached 502 when GitHub can't be read", async () => {
    serveGitHub({
      "/git/matching-refs/tags/mobile-v": () =>
        new Response("unavailable", { status: 503 }),
    });

    const response = await downloadLatest();

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /android/download/[file]", () => {
  test("redirects the latest version from the latest lookup alone", async () => {
    const api = serveReleases();

    const response = await downloadFile("deskohub-1.2.3.apk");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(assetUrl("1.2.3"));
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(
      api.requests.filter(({ path }) => path === releasesApiPath("1.2.3"))
    ).toHaveLength(1);
  });

  test("redirects an older version to its own release's APK", async () => {
    const api = serveReleases();

    const response = await downloadFile("deskohub-1.2.2.apk");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(assetUrl("1.2.2"));
    expect(api.requests.map(({ path }) => path)).toContain(
      releasesApiPath("1.2.2")
    );
    // A published release never changes, so its lookup is shared for a day.
    expect(nextCache.calls).toContainEqual({
      cacheLife: { stale: 3600, revalidate: 86_400, expire: 604_800 },
    });
  });

  test("answers 404 for a version without a release", async () => {
    serveReleases();

    const response = await downloadFile("deskohub-1.2.1.apk");

    expect(response.status).toBe(404);
    expect(response.headers.get("Location")).toBeNull();
    // Rechecked like the latest release, in case it is published late.
    expect(nextCache.calls).toContainEqual({
      cacheLife: { stale: 300, revalidate: 600, expire: 86_400 },
    });
  });

  test("answers 404 for an untagged older version without asking GitHub for its release", async () => {
    const api = serveReleases();

    const response = await downloadFile("deskohub-1.1.0.apk");

    expect(response.status).toBe(404);
    expect(api.requests.map(({ path }) => path)).not.toContain(
      releasesApiPath("1.1.0")
    );
  });

  test("answers 404 above the latest version without asking GitHub for it", async () => {
    const api = serveReleases();

    const response = await downloadFile("deskohub-1.3.0.apk");

    expect(response.status).toBe(404);
    expect(api.requests.map(({ path }) => path)).not.toContain(
      releasesApiPath("1.3.0")
    );
  });

  test.each([
    "deskohub-1.2.apk",
    "deskohub-01.2.3.apk",
    "deskohub-1.2.3.apk.sha256",
    "other-1.2.3.apk",
  ])("answers 404 for %s without asking GitHub", async (file) => {
    const api = serveReleases();

    const response = await downloadFile(file);

    expect(response.status).toBe(404);
    expect(api.requests).toEqual([]);
  });

  test("answers an uncached 502 when GitHub can't be read", async () => {
    serveGitHub({
      "/git/matching-refs/tags/mobile-v": () =>
        Response.json([
          { ref: "refs/tags/mobile-v1.2.2" },
          { ref: "refs/tags/mobile-v1.2.3" },
        ]),
      [releasePath("1.2.3")]: () => Response.json(githubMobileRelease("1.2.3")),
      [releasePath("1.2.2")]: () =>
        new Response("unavailable", { status: 503 }),
    });

    const response = await downloadFile("deskohub-1.2.2.apk");

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
