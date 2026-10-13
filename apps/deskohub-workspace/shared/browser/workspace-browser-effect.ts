import { NextEffect } from "@deskohub/next-effect";
import { Effect } from "effect";
import { WorkspaceBrowserLoggerLive } from "./workspace-browser-logs";

interface RunWorkspaceBrowserEffectOptions {
  readonly signal?: AbortSignal;
}

/**
 * Runs a Workspace Effect in the browser, the client counterpart of
 * `runWorkspaceEffect`. Logs go through the censoring browser logger and
 * carry `operation`. The promise rejects with the squashed failure or
 * defect; Next.js control flow such as `redirect` and `notFound` is rethrown
 * unchanged, and an aborted `signal` interrupts the run.
 */
export const runWorkspaceBrowserEffect =
  (operation: string, options: RunWorkspaceBrowserEffectOptions = {}) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    workspaceBrowserRuntime.run(
      effect.pipe(Effect.annotateLogs({ boundary: "browser", operation })),
      { signal: options.signal }
    );

// Built on first run and kept for the life of the page.
const workspaceBrowserRuntime = NextEffect.make({
  layer: WorkspaceBrowserLoggerLive,
});
