import { expect, test } from "bun:test";
import {
  runWorkspacePlaywrightSuites,
  runWorkspacePlaywrightWithFailureCleanup,
} from "./playwright-runner";

test("runs the cleanup-only project after a failed suite and preserves its exit", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return invocation === "suite" ? 1 : 0;
    }
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({ suiteExitCode: 1, cleanupExitCode: 0 });
});

test("does not rerun cleanup after a successful suite", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return 0;
    }
  );

  expect(invocations).toEqual(["suite"]);
  expect(result).toEqual({ suiteExitCode: 0 });
});

test("reports a failed cleanup-only project without losing the suite failure", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return 1;
    }
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({ suiteExitCode: 1, cleanupExitCode: 1 });
});

test("keeps the suite failure when the cleanup process cannot start", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      if (invocation === "suite") return 1;
      throw new Error("private process error");
    }
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({
    suiteExitCode: 1,
    cleanupCouldNotStart: true,
  });
});

test("waits for the failed checkout and its cleanup when instant navigation cannot launch", async () => {
  const events: string[] = [];
  const launchFailure = new Error("private process error");
  const result = await runWorkspacePlaywrightSuites({
    checkout: async (invocation) => {
      events.push(`${invocation}:start`);
      await Bun.sleep(5);
      events.push(`${invocation}:end`);
      return invocation === "suite" ? 1 : 0;
    },
    instantNavigation: () => {
      events.push("instant-navigation:launch");
      throw launchFailure;
    },
  });
  events.push("settled");

  expect(events).toEqual([
    "suite:start",
    "instant-navigation:launch",
    "suite:end",
    "failure-cleanup:start",
    "failure-cleanup:end",
    "settled",
  ]);
  expect(result).toEqual({
    checkout: {
      status: "fulfilled",
      value: { suiteExitCode: 1, cleanupExitCode: 0 },
    },
    instantNavigation: { status: "rejected", reason: launchFailure },
  });
});

test("waits for instant navigation when the checkout run cannot launch", async () => {
  const events: string[] = [];
  const launchFailure = new Error("private process error");
  const result = await runWorkspacePlaywrightSuites({
    checkout: () => {
      events.push("suite:launch");
      throw launchFailure;
    },
    instantNavigation: async () => {
      events.push("instant-navigation:start");
      await Bun.sleep(5);
      events.push("instant-navigation:end");
      return 0;
    },
  });
  events.push("settled");

  expect(events).toEqual([
    "suite:launch",
    "instant-navigation:start",
    "instant-navigation:end",
    "settled",
  ]);
  expect(result).toEqual({
    checkout: { status: "rejected", reason: launchFailure },
    instantNavigation: { status: "fulfilled", value: 0 },
  });
});
