import { expect, mock, spyOn, test } from "bun:test";
import { Effect, Layer } from "effect";

const runtimeBuildFailure = new Error("tracing exporter unavailable");

// The shared runtime builds its observability layer before entering any
// Effect, so this fails every run in this file before the program starts.
mock.module("@/instrumentation", () => ({ postHogLoggerProvider: undefined }));
mock.module("./observability/workspace-tracing", () => ({
  createWorkspaceTracingLive: () =>
    Layer.effectDiscard(Effect.fail(runtimeBuildFailure)),
  WorkspaceTracingLive: Layer.effectDiscard(Effect.fail(runtimeBuildFailure)),
}));

const { runWorkspaceEffect, runWorkspaceEffectOrElse } = await import(
  "./workspace-effect"
);

test("runWorkspaceEffect rejects before entering the Effect when the runtime cannot be built", async () => {
  const program = mock(() => "value");

  await expect(
    Effect.sync(program).pipe(runWorkspaceEffect("test.runtime-failure"))
  ).rejects.toBe(runtimeBuildFailure);
  expect(program).not.toHaveBeenCalled();
});

test("runWorkspaceEffectOrElse falls back once and logs once when the runtime cannot be built", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  const program = mock(() => "value");
  const orElse = mock(() => "fallback" as const);

  try {
    const result = await Effect.sync(program).pipe(
      runWorkspaceEffectOrElse("test.runtime-failure", {
        failureCode: "test.runtime_failure",
        orElse,
      })
    );

    expect(result).toBe("fallback");
    expect(program).not.toHaveBeenCalled();
    expect(orElse).toHaveBeenCalledTimes(1);
    expect(orElse).toHaveBeenCalledWith(runtimeBuildFailure);
    expect(warn).toHaveBeenCalledTimes(1);
    const output = warn.mock.calls.flat().join(" ");
    expect(output).toContain("test.runtime_failure");
    expect(output).toContain("test.runtime-failure");
  } finally {
    warn.mockRestore();
  }
});
