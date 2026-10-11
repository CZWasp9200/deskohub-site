import { Context, Effect, Layer, ManagedRuntime } from "effect";

/**
 * Returns a function that provides `layer` to an Effect, building the layer
 * on first use and reusing the built context for every later run.
 *
 * The backing runtime is never disposed: serverless processes end without a
 * shutdown hook, so a shared layer must not rely on finalizers. A failed build
 * stays cached.
 */
export const makeSharedLayerProvider = <R, LE>(
  layer: Layer.Layer<R, LE, never>,
  memoMap?: Layer.MemoMap
) => {
  const runtime = ManagedRuntime.make(layer, { memoMap });

  return <A, E>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | LE> =>
    Effect.flatMap(runtime.contextEffect, (context) =>
      Effect.provideContext(effect, isolateNestedLayers(context))
    );
};

// A built context carries the memo map it was built with, and nested
// `Effect.provide` calls memoize into it. Give every run its own memo map, as a
// per-run `Effect.provide` would, so concurrent runs never share layers their
// handlers provide.
const isolateNestedLayers = <R>(context: Context.Context<R>) =>
  Context.add(context, Layer.CurrentMemoMap, Layer.makeMemoMapUnsafe());
