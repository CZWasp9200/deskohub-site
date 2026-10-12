import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

/**
 * Runs `effect` on a TestClock that advances in steps far shorter than any
 * request timeout until the effect finishes, so sleeps and retry backoff
 * elapse instantly. Only for stubs that answer without real-time delays: a
 * stub that waits on a real timer would hit its request timeout.
 */
export const withInstantSleeps = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust("10 millis");
    }
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()));
