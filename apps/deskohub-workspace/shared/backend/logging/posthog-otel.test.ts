import { describe, expect, test } from "bun:test";
import type { LoggerProvider } from "@opentelemetry/api-logs";
import { Effect, Logger } from "effect";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { flushPostHogLogs } from "./posthog-otel";

describe("PostHog OTel logs", () => {
  test("bounds a flush by its deadline when the logger provider does not settle", async () => {
    const provider = {
      forceFlush: () => new Promise<void>(() => undefined),
    } as Pick<LoggerProvider, "forceFlush">;

    const warnings = await runFlush(flushPostHogLogs({ provider }));

    expect(warnings).toEqual([
      "PostHog log flush exceeded its post-response deadline.",
    ]);
  });

  test("warns without failing when the logger provider rejects", async () => {
    const provider = {
      forceFlush: () => Promise.reject(new Error("export failed")),
    } as Pick<LoggerProvider, "forceFlush">;

    const warnings = await runFlush(
      flushPostHogLogs({ provider, timeoutMs: 1_000 })
    );

    expect(warnings).toEqual(["PostHog log flush failed."]);
  });
});

const runFlush = async (flush: Effect.Effect<void>) => {
  const warnings: unknown[] = [];
  const captureLogger = Logger.make(({ logLevel, message }) => {
    if (logLevel === "Warn") {
      warnings.push(Array.isArray(message) ? message[0] : message);
    }
  });

  await Effect.runPromise(
    withInstantSleeps(flush).pipe(Effect.provide(Logger.layer([captureLogger])))
  );

  return warnings;
};
