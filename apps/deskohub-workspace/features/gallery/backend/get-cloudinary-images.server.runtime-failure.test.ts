import "@/shared/testing/workspace-test-env";

import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Effect, Layer, Predicate } from "effect";

const runtimeStartFailure = new Error("synthetic tracing exporter unavailable");
const cacheLife = mock(
  (_profile: string | { stale: number; revalidate: number; expire: number }) =>
    undefined
);
const originalFetch = globalThis.fetch;
const fetchCalls = mock(async () => new Response("[]", { status: 200 }));

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// The real Workspace runner builds its observability layer before entering
// the gallery Effect, so this fails every run in this file before the lookup
// starts, as a production runtime that cannot start would.
mock.module("@/instrumentation", () => ({ postHogLoggerProvider: undefined }));
mock.module("@/shared/backend/observability/workspace-tracing", () => ({
  createWorkspaceTracingLive: () =>
    Layer.effectDiscard(Effect.fail(runtimeStartFailure)),
  WorkspaceTracingLive: Layer.effectDiscard(Effect.fail(runtimeStartFailure)),
}));
mock.module("cloudinary", () => ({
  v2: {
    config: mock(() => undefined),
    url: mock(
      (source: string) =>
        `https://res.cloudinary.test/test-cloud/image/list/${encodeURIComponent(source)}.json`
    ),
  },
}));
mock.module("next/cache", () => ({
  cacheLife,
  cacheTag: () => undefined,
  revalidateTag: () => undefined,
}));
mock.module("@/env", () => ({
  env: {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "test-key",
    CLOUDINARY_API_SECRET: "test-secret",
  },
}));

const { getCloudinaryImages } = await import("./get-cloudinary-images.server");

test("serves no images with the failure cache profile when the Workspace runtime cannot start", async () => {
  globalThis.fetch = Object.assign(fetchCalls, {
    preconnect: originalFetch.preconnect,
  });
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);

  try {
    const images = await getCloudinaryImages({ tags: [["gallery"]] });

    expect(images).toEqual([]);
    expect(fetchCalls).not.toHaveBeenCalled();
    const [galleryProfile, failureProfile] = cacheLife.mock.calls.flatMap(
      ([profile]) => (Predicate.isString(profile) ? [] : [profile])
    );
    expect(failureProfile?.revalidate).toBeLessThanOrEqual(60);
    expect(failureProfile?.revalidate).toBeLessThan(
      galleryProfile?.revalidate ?? 0
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(" ")).toContain(
      "gallery.images.load_failed"
    );
  } finally {
    warn.mockRestore();
  }
});
