import { Effect, Layer, ManagedRuntime } from "effect";

/**
 * Returns a function that provides `layer` to an Effect through a
 * `ManagedRuntime`, so the layer is built on first use and reused by every
 * later run.
 *
 * Runs provide the runtime's context rather than calling
 * `runtime.runPromise`: `mapError` must still see layer build failures, and a
 * custom `run` receives an Effect, not a result.
 *
 * The runtime is never disposed: serverless processes end without a shutdown
 * hook, so a shared layer must not rely on finalizers. A failed build stays
 * cached.
 */
export const makeSharedLayerProvider = <R, LE>(
  layer: Layer.Layer<R, LE, never>,
  memoMap?: Layer.MemoMap
) => {
  const runtime = ManagedRuntime.make(layer, { memoMap });

  return <A, E>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | LE> =>
    Effect.flatMap(runtime.contextEffect, (context) =>
      Effect.provideContext(
        // Layers a run provides itself memoize into the current memo map. A
        // per-run fork reuses the shared layers but keeps new ones per run, as
        // a per-run `Effect.provide(layer)` did, so concurrent requests never
        // share them.
        Effect.provideService(
          effect,
          Layer.CurrentMemoMap,
          Layer.forkMemoMapUnsafe(runtime.memoMap)
        ),
        context
      )
    );
};
