import { describe, expect, test } from "bun:test";
import { Clock, Data, Duration, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  EmailPreparationRetry,
  retryTemporary,
} from "./email-value-generation";

class Temporary extends Data.TaggedError("Temporary") {}
class Permanent extends Data.TaggedError("Permanent") {}

/** Fails every attempt and records the TestClock time of each one. */
const failingAttempts = (failure: Temporary | Permanent) => {
  const attemptedAt: number[] = [];
  const attempt = Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => {
      attemptedAt.push(now);
      return Effect.fail(failure);
    })
  );
  return { attemptedAt, attempt };
};

const runRetried = (failure: Temporary | Permanent) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { attemptedAt, attempt } = failingAttempts(failure);
      const fiber = yield* attempt.pipe(
        retryTemporary(
          (error: Temporary | Permanent) => error._tag === "Temporary"
        ),
        Effect.provideService(EmailPreparationRetry, {
          retries: 2,
          baseDelay: Duration.millis(100),
        }),
        Effect.exit,
        Effect.forkChild
      );
      yield* TestClock.adjust(Duration.seconds(10));
      const exit = yield* Fiber.join(fiber);
      return { exit, attemptedAt };
    }).pipe(Effect.provide(Layer.fresh(TestClock.layer())))
  );

describe("retryTemporary", () => {
  test("retries a temporary failure the configured number of times with exponential delays", async () => {
    const { exit, attemptedAt } = await runRetried(new Temporary());

    expect(Exit.isFailure(exit)).toBe(true);
    // One attempt plus two retries, after 100 ms and then 200 ms.
    expect(attemptedAt).toEqual([0, 100, 300]);
  });

  test("does not retry a failure that is not temporary", async () => {
    const { exit, attemptedAt } = await runRetried(new Permanent());

    expect(Exit.isFailure(exit)).toBe(true);
    expect(attemptedAt).toEqual([0]);
  });
});
