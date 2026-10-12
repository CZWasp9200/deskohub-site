import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStepRunner } from "../types";
import { assertLocaleSwitcher } from "./locale";

test("switches to Czech and back to English through native link activation", async () => {
  const calls: Array<{ readonly args: string[] }> = [];
  const visitedLocales: string[] = [];
  let locale = "en-US";
  let focusedSelector: string | undefined;
  const run: Runner = async (_command, args) => {
    calls.push({ args });
    const command = args.slice(2);

    if (command[0] === "open") return success();
    if (command[0] === "wait") return success();
    if (command[0] === "focus") {
      focusedSelector = command[1];
      return success();
    }
    if (command[0] === "press") {
      locale = focusedSelector?.includes("/cs-CZ") ? "cs-CZ" : "en-US";
      visitedLocales.push(locale);
      return success();
    }
    if (command[0] === "get" && command[1] === "url") {
      return success(`https://workspace.example/${locale}`);
    }

    throw new Error(`Unexpected browser command: ${command.join(" ")}`);
  };
  const runStep: WorkspaceE2EStepRunner = ({ execute }) => execute;

  await Effect.runPromise(
    assertLocaleSwitcher({
      config: makeConfig(),
      run,
      runStep,
      session: "locale-test",
    })
  );

  expect(visitedLocales).toEqual(["cs-CZ", "en-US"]);
  expect(calls.some(({ args }) => args.includes("eval"))).toBe(false);
});

const success = (stdout = "") => ({ exitCode: 0, stderr: "", stdout });

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://workspace.example",
  bypassSecret: undefined,
  expectedHost: "workspace.example",
  timeouts: workspaceE2ETimeouts,
});
