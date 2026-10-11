import { expect, test } from "bun:test";
import { Effect, Logger } from "effect";
import { DiscountProviderError } from "./errors";
import { logDiscountResolutionFailure } from "./resolution-logging";

test("includes the failure cause in the error log", async () => {
  const cause = new DiscountProviderError({
    reason: "provider_failure",
    message: "Discount definitions could not be loaded.",
    cause: new Error("database failure"),
  });
  let loggedMessage: unknown;
  const captureLogger = Logger.make((options) => {
    loggedMessage = options.message;
  });

  await Effect.runPromise(
    logDiscountResolutionFailure({
      cause,
      operation: "load_definition",
      provider: "calendar",
    }).pipe(Effect.provide(Logger.layer([captureLogger])))
  );

  expect(loggedMessage).toEqual([
    "Discount provider resolution failed",
    { cause },
  ]);
});
