import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Cause, Effect, Exit } from "effect";
import { formatWorkspaceE2EFailure, workspaceE2ETimeoutError } from "../errors";
import { type E2EOutcome, toE2EResult } from "../services/telemetry";
import { workspaceE2EAccessCodeMutationBarrierCount } from "../timeouts";
import {
  type ActionResponseOutcome,
  awaitActionQuiescence,
  runFinalizedCase,
  sanitizedBrowserOperation,
  selectActionReplayHeaders,
} from "./access-code-case";

describe("access code creation case planning", () => {
  test("keeps only action-relevant headers when replaying a captured request", () => {
    const replayHeaders = selectActionReplayHeaders({
      accept: "*/*",
      "accept-encoding": "gzip, deflate",
      authorization: "Basic c2VjcmV0",
      connection: "keep-alive",
      "content-length": "256",
      "content-type": "text/plain;charset=UTF-8",
      cookie: "_vercel_protection_bypass=secret",
      host: "deskohub-workspace-site-abc12345-deskohub.vercel.app",
      "next-action": "7f9c0e2b",
      "next-router-state-tree": "%5B%22%22%5D",
      origin: "https://deskohub-workspace-site-abc12345-deskohub.vercel.app",
      "x-vercel-protection-bypass": "secret",
    });

    expect(replayHeaders).toEqual({
      accept: "*/*",
      "accept-encoding": "gzip, deflate",
      "content-type": "text/plain;charset=UTF-8",
      "next-action": "7f9c0e2b",
      "next-router-state-tree": "%5B%22%22%5D",
      origin: "https://deskohub-workspace-site-abc12345-deskohub.vercel.app",
    });
  });
});

describe("sanitized browser failure reporting", () => {
  test("discards raw causes that can carry credentials, cookies, bypass, or the PIN", async () => {
    const credentialPair = "e2e-admin:s3cret-panther-value";
    const encodedCredential = Buffer.from(credentialPair).toString("base64");
    const bypassSecret = "raw-vercel-bypass-secret";
    const fixturePin = "1111111";
    const leakedCause = new Error(
      `request failed with headers {"authorization":"Basic ${encodedCredential}",` +
        `"cookie":"_vercel_protection_bypass=${bypassSecret}",` +
        `"x-vercel-protection-bypass":"${bypassSecret}"} body pin=${fixturePin} pair=${credentialPair}`
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        sanitizedBrowserOperation("probe the protected admin page", () =>
          Promise.reject(leakedCause)
        )
      )
    );

    expect(failure.operation).toBe("probe the protected admin page");
    expect(failure.cause).toBeUndefined();
    for (const secret of [
      credentialPair,
      encodedCredential,
      bypassSecret,
      fixturePin,
    ]) {
      expect(failure.message).not.toContain(secret);
      expect(formatWorkspaceE2EFailure(failure)).not.toContain(secret);
      expect(JSON.stringify(failure)).not.toContain(secret);
    }
    expect(failure.message).toBe("probe the protected admin page failed");
  });
});

describe("case finalization order", () => {
  test("marks cleanup-only failures failed, keeps them in the traced exit, and annotates once after trace finalization", async () => {
    const operations: string[] = [];
    let annotatedOutcomes: E2EOutcome[] = [];

    const exit = await Effect.runPromiseExit(
      runFinalizedCase({
        body: Effect.sync(() => {
          operations.push("body");
        }),
        cleanup: Effect.gen(function* () {
          operations.push("cleanup");
          return yield* workspaceE2ETimeoutError("cleanup timed out", {
            operation: "cleanup",
          });
        }).pipe(Effect.orDie),
        trace: (finalized) =>
          Effect.onExit(finalized, (tracedExit) =>
            Effect.sync(() => {
              operations.push("trace-finalize");
              if (!Exit.isSuccess(tracedExit)) {
                annotatedOutcomes = [
                  ...annotatedOutcomes,
                  toE2EResult(tracedExit).outcome,
                ];
              }
            })
          ),
        onExit: (settled) => {
          operations.push("annotation");
          if (!Exit.isSuccess(settled)) {
            annotatedOutcomes = [
              ...annotatedOutcomes,
              toE2EResult(settled).outcome,
            ];
          }
        },
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(operations).toEqual([
      "body",
      "cleanup",
      "trace-finalize",
      "annotation",
    ]);
    expect(annotatedOutcomes).toEqual(["failed", "failed"]);
  });
});

describe("action completion barrier", () => {
  test("deletes only after the retained action response settles", async () => {
    const operations: string[] = [];
    let releaseResponse: (() => void) | undefined;
    const responseSettled = new Promise<ActionResponseOutcome>((resolve) => {
      releaseResponse = () => resolve({ kind: "responded" });
    });

    const completed = Effect.runPromise(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 5_000,
          label: "initial access code action",
          responseSettled,
          waitForTerminalEvent: Effect.sync(() => {
            operations.push("converge");
            return true;
          }),
        });
        operations.push("delete");
      })
    ).then(() => operations.push("done"));

    await Bun.sleep(10);
    operations.push("server-write");
    releaseResponse?.();
    await completed;

    expect(operations).toEqual(["server-write", "delete", "done"]);
  });

  test("falls back to bounded terminal convergence when the barrier times out", async () => {
    const operations: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 20,
          label: "initial access code action",
          responseSettled: new Promise<ActionResponseOutcome>(() => {}),
          waitForTerminalEvent: Effect.gen(function* () {
            operations.push("converge");
            yield* Effect.sleep(5);
            operations.push("terminal");
            return true;
          }),
        });
        operations.push("delete");
      })
    );

    expect(operations).toEqual(["converge", "terminal", "delete"]);
  });

  test("fails closed without deletion when the terminal event never converges", async () => {
    const operations: string[] = [];

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 20,
          label: "initial access code action",
          responseSettled: Promise.resolve({ kind: "unresolved" }),
          waitForTerminalEvent: Effect.gen(function* () {
            operations.push("converge");
            return yield* workspaceE2ETimeoutError("convergence timed out", {
              operation: "converge",
            });
          }),
        });
        operations.push("delete");
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(operations).toEqual(["converge"]);
  });

  test("fails closed without deletion when the replay response never settles", async () => {
    const operations: string[] = [];

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 20,
          label: "replayed access code action",
          responseSettled: Promise.resolve({ kind: "unresolved" }),
        });
        operations.push("delete");
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(operations).toEqual([]);
  });

  test("fails closed without deletion when the replay barrier times out", async () => {
    const operations: string[] = [];

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 20,
          label: "replayed access code action",
          responseSettled: new Promise<ActionResponseOutcome>(() => {}),
        });
        operations.push("delete");
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(Cause.squash(exit.cause))).toContain(
      "replayed access code action response did not settle"
    );
    expect(operations).toEqual([]);
  });
});

describe("access code cleanup budget", () => {
  test("budgets every mutation barrier the case waits on", () => {
    const caseSource = readFileSync(
      resolve(import.meta.dir, "create-access-code.pw.ts"),
      "utf8"
    );
    // Comment-aware: a commented-out barrier call must not count as a wait.
    const activeCaseSource = caseSource
      .split("\n")
      .map((line) => {
        const commentAt = line.indexOf("//");
        return commentAt === -1 ? line : line.slice(0, commentAt);
      })
      .join("\n");
    const barrierWaits =
      activeCaseSource.split("awaitActionQuiescence(").length - 1;

    expect(barrierWaits).toBe(workspaceE2EAccessCodeMutationBarrierCount);
  });
});
