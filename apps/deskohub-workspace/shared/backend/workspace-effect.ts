import { NextEffect } from "@deskohub/next-effect";
import { Data, Effect, Layer } from "effect";
import { after } from "next/server";
import { postHogLoggerProvider } from "@/instrumentation";
import {
  createWorkspaceOtelLoggerLive,
  WorkspaceLoggerLive,
} from "./logging/censorship";
import { flushPostHogLogs } from "./logging/posthog-otel";
import { WorkspaceTracingLive } from "./observability/workspace-tracing";

type WorkspaceEffectBoundary = "action" | "page" | "route" | "run" | "task";

interface RunWorkspaceEffectOptions {
  readonly boundary?: WorkspaceEffectBoundary;
  readonly signal?: AbortSignal;
}

class WorkspaceTelemetryError extends Data.TaggedError(
  "WorkspaceTelemetryError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export const runWorkspaceEffect =
  (operation: string, options: RunWorkspaceEffectOptions = {}) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    workspaceRuntime.run(
      effect.pipe(
        Effect.annotateLogs({
          boundary: options.boundary ?? "run",
          operation,
        })
      ),
      { signal: options.signal }
    );

export const defineWorkspaceTask =
  <Args extends readonly unknown[], A, E>(
    operation: string,
    handler: (...args: Args) => Effect.Effect<A, E, never>
  ) =>
  (...args: Args): Promise<A> =>
    Effect.suspend(() => handler(...args)).pipe(
      Effect.ensuring(flushTelemetry),
      runWorkspaceEffect(operation, { boundary: "task" })
    );

export const defineWorkspacePage = <Props, A, E>(
  operation: string,
  component: (props: Props) => Effect.Effect<A, E, never>
) =>
  workspaceRuntime.page((props: Props) =>
    component(props).pipe(
      Effect.annotateLogs({
        boundary: "page",
        operation,
      })
    )
  );

export const scheduleWorkspaceTelemetryFlush = () =>
  postHogLoggerProvider
    ? Effect.try({
        try: () =>
          after(() =>
            flushTelemetry.pipe(runWorkspaceEffect("telemetry.flush"))
          ),
        catch: (cause) =>
          new WorkspaceTelemetryError({
            cause,
            message: "PostHog log flush could not be scheduled",
          }),
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("PostHog log flush could not be scheduled", {
            cause,
          })
        ),
        Effect.ignore
      )
    : Effect.void;

export const WorkspaceObservabilityLive = Layer.merge(
  postHogLoggerProvider
    ? createWorkspaceOtelLoggerLive(postHogLoggerProvider)
    : WorkspaceLoggerLive,
  WorkspaceTracingLive
);

/**
 * Process-wide memo map for Workspace runtimes. Runtimes that build their
 * layers with it reuse layers another runtime has already built, such as
 * `WorkspaceObservabilityLive`.
 */
export const workspaceMemoMap = Layer.makeMemoMapUnsafe();

// Built on first run and kept for the life of the process. It is never
// disposed: telemetry is flushed per request through `after()` and per task
// through `Effect.ensuring`, not by closing a layer scope.
const workspaceRuntime = NextEffect.make({
  layer: WorkspaceObservabilityLive,
  memoMap: workspaceMemoMap,
});

// Telemetry is best effort: an unexpected flush defect must not fail the
// request or task it follows.
const flushTelemetry = flushPostHogLogs({
  provider: postHogLoggerProvider,
}).pipe(
  Effect.ignoreCause({ log: "Warn", message: "PostHog log flush failed" })
);
