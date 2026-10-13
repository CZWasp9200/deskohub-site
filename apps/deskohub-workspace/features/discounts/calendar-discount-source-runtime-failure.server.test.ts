import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";

import { expect, mock, spyOn, test } from "bun:test";
import { Effect, Layer } from "effect";

const runtimeBuildFailure = new Error("tracing exporter unavailable");
const cacheLife = mock(
  (_profile: string | { readonly expire: number }) => undefined
);
const cacheTag = mock((_tag: string) => undefined);

// The shared runtime builds its observability layer before entering any
// Effect, so every run in this file fails before the Calendar load starts.
mock.module("next/cache", () => ({ cacheLife, cacheTag }));
mock.module("@/instrumentation", () => ({ postHogLoggerProvider: undefined }));
mock.module("@/shared/backend/observability/workspace-tracing", () => ({
  createWorkspaceTracingLive: () =>
    Layer.effectDiscard(Effect.fail(runtimeBuildFailure)),
  WorkspaceTracingLive: Layer.effectDiscard(Effect.fail(runtimeBuildFailure)),
}));

const { loadCalendarDiscountSource } = await import(
  "./calendar-discount-source.server"
);

test("marks the Calendar sale source uncacheable when the runner cannot start", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);

  try {
    await expect(loadCalendarDiscountSource("2026-07-14")).rejects.toBe(
      runtimeBuildFailure
    );
    expect(cacheLife.mock.calls).toEqual([[{ expire: 0 }]]);
    expect(cacheTag).not.toHaveBeenCalled();
    // The rejection reaches callers that already log it, so the runner
    // must not log it again.
    expect(warn.mock.calls.flat().join(" ")).not.toContain(
      "calendar_discount_source_load_failed"
    );
  } finally {
    warn.mockRestore();
  }
});
