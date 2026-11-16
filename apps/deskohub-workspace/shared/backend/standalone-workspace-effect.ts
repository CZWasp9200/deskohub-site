import { NextEffect } from "@deskohub/next-effect";
import { Effect, Layer } from "effect";
import { WorkspaceLoggerLive } from "./logging/censorship";
import { WorkspaceClockLive } from "./observability/workspace-clock";

const runtime = NextEffect.make({
  layer: Layer.merge(WorkspaceLoggerLive, WorkspaceClockLive),
});

export const runStandaloneWorkspaceEffect = (operation: string) =>
  function runEffect<A, E>(effect: Effect.Effect<A, E, never>) {
    return runtime.run(
      effect.pipe(
        Effect.annotateLogs({
          boundary: "run",
          operation,
        })
      )
    );
  };
