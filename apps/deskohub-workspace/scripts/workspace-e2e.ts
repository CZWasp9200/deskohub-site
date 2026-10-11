import "../shared/polyfills/temporal";

import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Layer } from "effect";
import { makeWorkspaceE2EEnvironment } from "../e2e/e2e-env";
import { formatWorkspaceE2EFailure, workspaceE2EError } from "../e2e/errors";
import { runWorkspacePlaywrightWithFailureCleanup } from "../e2e/playwright-runner";
import { workspaceDir } from "../e2e/runtime";
import {
  E2ERunContextService,
  E2ETelemetryService,
  makeE2ERunContext,
} from "../e2e/services/telemetry";
import {
  makeE2ETelemetryRuntime,
  runE2EEffect,
} from "../e2e/telemetry-runtime";

const environment = makeWorkspaceE2EEnvironment();
const runContext = makeE2ERunContext(environment);
const telemetry = makeE2ETelemetryRuntime(environment);
const telemetryServiceLayer = E2ETelemetryService.Default.pipe(
  Layer.provide(E2ERunContextService.layerValue(runContext))
);
const playwrightEnvironment = Object.fromEntries(
  Object.entries(environment).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)]]
  )
);
const runPlaywright = Effect.gen(function* () {
  const e2eTelemetry = yield* E2ETelemetryService;
  yield* e2eTelemetry.traceRun(
    Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      const spawnPlaywright = (
        config: string,
        options: readonly string[] = []
      ) =>
        Bun.spawn(
          ["bunx", "playwright", "test", "--config", config, ...options],
          {
            cwd: workspaceDir,
            env: {
              ...playwrightEnvironment,
              WORKSPACE_E2E_RUN_CONTEXT: JSON.stringify(runContext),
              WORKSPACE_E2E_TRACE_PARENT: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
            },
            stderr: "inherit",
            stdin: "inherit",
            stdout: "inherit",
          }
        ).exited;
      // Read-only instant navigation runs beside the checkout graph instead
      // of gating its setup phase; both always target the remote preview.
      const [result, instantNavigationExitCode] = yield* Effect.tryPromise({
        catch: (cause) =>
          workspaceE2EError("Could not launch Playwright E2E", {
            cause,
            operation: "launch Playwright E2E",
          }),
        try: () =>
          Promise.all([
            runWorkspacePlaywrightWithFailureCleanup((invocation) =>
              spawnPlaywright(
                "playwright.e2e.config.ts",
                invocation === "failure-cleanup"
                  ? [
                      "--project=checkout-cleanup",
                      "--no-deps",
                      `--output=e2e-artifacts/checkout-cleanup-recovery-${randomUUID()}`,
                    ]
                  : []
              )
            ),
            spawnPlaywright("playwright.instant-navigation.config.ts"),
          ]),
      });
      if (result.cleanupCouldNotStart) {
        process.stderr.write(
          "Workspace E2E cleanup-only project could not start after the main suite failed.\n"
        );
      } else if (
        result.cleanupExitCode !== undefined &&
        result.cleanupExitCode !== 0
      ) {
        process.stderr.write(
          `Workspace E2E cleanup-only project exited with ${result.cleanupExitCode} after the main suite failed.\n`
        );
      }
      if (result.suiteExitCode !== 0) {
        if (instantNavigationExitCode !== 0) {
          process.stderr.write(
            `Playwright instant navigation E2E exited with ${instantNavigationExitCode}.\n`
          );
        }
        return yield* workspaceE2EError(
          `Playwright checkout E2E exited with ${result.suiteExitCode}`,
          { operation: "run Playwright checkout E2E" }
        );
      }
      if (instantNavigationExitCode !== 0) {
        return yield* workspaceE2EError(
          `Playwright instant navigation E2E exited with ${instantNavigationExitCode}`,
          { operation: "run Playwright instant navigation E2E" }
        );
      }
    })
  );
}).pipe(Effect.provide(telemetryServiceLayer));
const exit = await runE2EEffect(runPlaywright, telemetry);

if (Exit.isFailure(exit)) {
  process.stderr.write(
    `${formatWorkspaceE2EFailure(Cause.squash(exit.cause))}\n`
  );
  process.exit(1);
}
