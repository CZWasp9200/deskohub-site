import { describe, expect, spyOn, test } from "bun:test";
import { Clock, Effect } from "effect";
import { WorkspaceClockLive } from "./workspace-clock";

/** Runs `effect` while any read of `Date.now()` throws, as a prerender does. */
const withoutDateNow = async <A>(effect: Effect.Effect<A>) => {
  const now = spyOn(Date, "now").mockImplementation(() => {
    throw new Error("The current time was read during a prerender.");
  });
  try {
    return await Effect.runPromise(effect);
  } finally {
    now.mockRestore();
  }
};

describe("WorkspaceClockLive", () => {
  test("ends a span without reading Date.now()", async () => {
    const traced = Effect.succeed("done").pipe(
      Effect.withSpan("test.span"),
      Effect.provide(WorkspaceClockLive)
    );

    expect(await withoutDateNow(traced)).toBe("done");
  });

  test("stamps epoch nanoseconds", async () => {
    const before = BigInt(Date.now()) * 1_000_000n;
    const nanos = await Effect.runPromise(
      Clock.currentTimeNanos.pipe(Effect.provide(WorkspaceClockLive))
    );
    const after = BigInt(Date.now() + 1) * 1_000_000n;

    expect(nanos >= before - 5_000_000n && nanos <= after).toBe(true);
  });
});
