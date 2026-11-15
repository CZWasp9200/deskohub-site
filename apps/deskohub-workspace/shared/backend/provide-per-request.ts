import { type Context, Effect, Layer } from "effect";

/**
 * Provides `layer` to `self`, built for this request alone. It reuses what
 * the enclosing run or handler already built, and every other Layer it
 * builds, including those provided again inside `self`, stays out of
 * requests that overlap it.
 *
 * Use it where an HTTP API endpoint provides its request's Layers, so the
 * request keeps its own instances, along with whatever state they keep for
 * it, such as a cache or a release decision. Since Effect 4.1 a plain
 * `Effect.provide` also builds in a fork of the enclosing memo map, so the
 * two build the same way; this names the requirement where it matters.
 * Workspace runs need no such step: each run already builds in its own fork.
 */
export const providePerRequest =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | E2, RIn | Exclude<R, ROut>> =>
    Effect.scopedWith((scope) =>
      Effect.contextWith((context: Context.Context<never>) =>
        Layer.buildWithMemoMap(
          layer,
          Layer.CurrentMemoMap.forkOrCreate(context),
          scope
        )
      ).pipe(
        Effect.flatMap((services) => Effect.provideContext(self, services))
      )
    );
