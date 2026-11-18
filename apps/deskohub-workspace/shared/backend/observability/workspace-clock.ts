import { Clock, Effect, Layer } from "effect";

const nanosPerMilli = 1_000_000;

/** Epoch nanoseconds from the process's performance timeline. */
const performanceTimeNanos = () =>
  BigInt(
    Math.round((performance.timeOrigin + performance.now()) * nanosPerMilli)
  );

/**
 * The Workspace's clock: Effect's default clock, except that the wall-clock
 * nanoseconds spans are stamped with come from `performance.timeOrigin` and
 * `performance.now()`, as Next.js asks for timing. Effect 4.1's default reads
 * `Date.now()` for them, which Next.js rejects while prerendering a route
 * with request-time content, so every span of a page run would.
 */
export const WorkspaceClockLive = Layer.effect(
  Clock.Clock,
  Clock.clockWith((clock) =>
    Effect.succeed<Clock.Clock>({
      currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
      currentTimeMillis: clock.currentTimeMillis,
      currentTimeNanosUnsafe: performanceTimeNanos,
      currentTimeNanos: Effect.sync(performanceTimeNanos),
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: clock.monotonicTimeNanos,
      sleep: (duration) => clock.sleep(duration),
    })
  )
);
