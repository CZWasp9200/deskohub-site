import { NextEffect } from "@deskohub/next-effect";
import { Cause, Data, Effect, Exit, Layer, Result } from "effect";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { postHogLoggerProvider } from "@/instrumentation";
import {
  createWorkspaceOtelLoggerLive,
  WorkspaceLoggerLive,
} from "./logging/censorship";
import { flushPostHogLogs } from "./logging/posthog-otel";
import { WorkspaceTracingLive } from "./observability/workspace-tracing";
import { runStandaloneWorkspaceEffect } from "./standalone-workspace-effect";

type WorkspaceEffectBoundary = "action" | "page" | "route" | "run" | "task";

interface RunWorkspaceEffectOptions {
  readonly boundary?: WorkspaceEffectBoundary;
  readonly signal?: AbortSignal;
}

interface RunWorkspaceEffectOrElseOptions<B> extends RunWorkspaceEffectOptions {
  /** Stable, low-cardinality log code without IDs, URLs, or payload data. */
  readonly failureCode: string;
  /**
   * Runs exactly once on any failure, with the error `runWorkspaceEffect`
   * would have rejected with. Returns the fallback value, or rethrows to
   * reject after a side effect such as `cacheLife`.
   */
  readonly orElse: (cause: unknown) => B;
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

/**
 * Runs a Workspace Effect like `runWorkspaceEffect`, but answers every
 * failure with `orElse`: typed failures, defects, and a runner that rejects
 * before entering the Effect, such as when the shared observability runtime
 * cannot be built. A fallback inside the Effect cannot see that last case.
 * Next.js control flow (redirects, `notFound`, prerender bailouts) still
 * propagates. Each failure is logged once with `failureCode`.
 */
export const runWorkspaceEffectOrElse =
  <B>(
    operation: string,
    { failureCode, orElse, ...options }: RunWorkspaceEffectOrElseOptions<B>
  ) =>
  async <A, E>(effect: Effect.Effect<A, E, never>): Promise<A | B> => {
    const exit = await effect
      .pipe(
        Effect.exit,
        Effect.tap(logFallbackFailure(failureCode)),
        runWorkspaceEffect(operation, options)
      )
      .then(
        (exit): Exit.Exit<A, unknown> => exit,
        (cause: unknown) => {
          // Without the shared runtime, log through the standalone logger.
          const exit = Exit.die(cause);
          return logFallbackFailure(failureCode)(exit)
            .pipe(runStandaloneWorkspaceEffect(operation))
            .then(
              () => exit,
              // Nothing is left to log through when that logger fails too.
              () => exit
            );
        }
      );
    if (Exit.isSuccess(exit)) return exit.value;

    for (const failure of causeFailures(exit.cause)) {
      unstable_rethrow(failure);
    }
    return orElse(Cause.squash(exit.cause));
  };

const causeFailures = (cause: Cause.Cause<unknown>) =>
  cause.reasons.flatMap((reason) => {
    if (Cause.isFailReason(reason)) return [reason.error];
    if (Cause.isDieReason(reason)) return [reason.defect];
    return [];
  });

const isNextControlFlow = (cause: unknown) =>
  Result.isFailure(Result.try(() => unstable_rethrow(cause)));

const logFallbackFailure =
  (failureCode: string) =>
  <A, E>(exit: Exit.Exit<A, E>) =>
    Exit.isFailure(exit) && !causeFailures(exit.cause).some(isNextControlFlow)
      ? Effect.logWarning("Workspace Effect failed; serving its fallback", {
          failureCode,
          cause: exit.cause,
        })
      : Effect.void;

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
