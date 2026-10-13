import { NextEffect } from "@deskohub/next-effect";
import { Effect, References } from "effect";

interface RunWorkspaceBrowserEffectOptions {
  readonly signal?: AbortSignal;
}

/**
 * Runs a Workspace Effect in the browser, the client counterpart of
 * `runWorkspaceEffect`. The promise rejects with the squashed failure or
 * defect; Next.js control flow such as `redirect` and `notFound` is rethrown
 * unchanged, and an aborted `signal` interrupts the run. `Effect.log*` output
 * is discarded so raw causes never reach the console; report failures with
 * `reportWorkspaceBrowserFailure`, which reads this run's `operation`.
 */
export const runWorkspaceBrowserEffect =
  (operation: string, options: RunWorkspaceBrowserEffectOptions = {}) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    workspaceBrowserRuntime.run(
      effect.pipe(
        Effect.annotateLogs({ boundary: "browser", operation }),
        Effect.provideService(References.CurrentLoggers, noLoggers)
      ),
      { signal: options.signal }
    );

const workspaceBrowserRuntime = NextEffect.make();

// Effect's `Logger` module would add ~20 KB gzip to every page's first load.
const noLoggers = new Set<never>();
