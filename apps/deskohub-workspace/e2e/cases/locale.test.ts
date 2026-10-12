import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStepRunner } from "../types";
import {
  assertLocaleSwitcher,
  localePreferenceSavingReadyCondition,
  switchSignedInLocale,
} from "./locale";

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

/**
 * Evaluates the browser-side readiness check against a synthetic link whose
 * React fiber chain ends at the switcher component that owns it.
 */
const evaluateSavingReady = (
  link: Record<string, unknown> | null,
  selectedSelectors: string[] = []
): boolean =>
  new Function(
    "document",
    `return ${localePreferenceSavingReadyCondition("en-US")};`
  )({
    querySelector: (selector: string) => {
      selectedSelectors.push(selector);
      return link;
    },
  }) as boolean;

const switcherLink = (switcherProps: Record<string, unknown> | null) => {
  const switcherFiber = { memoizedProps: switcherProps, return: null };
  const spanFiber = { memoizedProps: { children: [] }, return: switcherFiber };
  return {
    __reactFiber$synthetic: {
      memoizedProps: { href: "/en-US/account", onClick: () => undefined },
      return: spanFiber,
    },
  };
};

test("accepts the switcher link only once its saving handler is committed", () => {
  const selectedSelectors: string[] = [];
  expect(
    evaluateSavingReady(
      switcherLink({ getLocaleHref: () => "/en-US", selectLocale: () => {} }),
      selectedSelectors
    )
  ).toBe(true);
  expect(selectedSelectors).toEqual([
    '[data-locale-switcher] a[href^="/en-US"]',
  ]);
});

test("rejects a switcher link that would navigate as a guest", () => {
  // Before the streamed signed-in promise resolves, and for guests, the
  // switcher renders the same hydrated link without a saving handler.
  expect(
    evaluateSavingReady(
      switcherLink({ getLocaleHref: () => "/en-US", selectLocale: undefined })
    )
  ).toBe(false);
  // A link that is not hydrated has no fiber to read.
  expect(evaluateSavingReady({})).toBe(false);
  expect(evaluateSavingReady(null)).toBe(false);
  // A fiber chain without the switcher component never counts as ready.
  expect(evaluateSavingReady(switcherLink({ selectLocale: () => {} }))).toBe(
    false
  );
});

test("activates the signed-in switch only after the saving handler is ready", async () => {
  const commands: string[] = [];
  let locale = "cs-CZ";
  const run: Runner = async (_command, args) => {
    const command = args.slice(2);
    commands.push(command[0] ?? "");
    if (command[0] === "wait") return success();
    if (command[0] === "focus") return success();
    if (command[0] === "press") {
      locale = "en-US";
      return success();
    }
    if (command[0] === "get" && command[1] === "url") {
      return success(`https://workspace.example/${locale}/account`);
    }
    throw new Error(`Unexpected browser command: ${command.join(" ")}`);
  };

  await Effect.runPromise(
    switchSignedInLocale(run, "locale-test", "en-US", workspaceE2ETimeouts)
  );

  // Saving readiness, then link hydration, then the native activation.
  expect(commands.slice(0, 4)).toEqual(["wait", "wait", "focus", "press"]);
  expect(locale).toBe("en-US");
});

test("never activates the switch while the saving handler is missing", async () => {
  const commands: string[] = [];
  const run: Runner = async (_command, args) => {
    const command = args.slice(2);
    commands.push(command[0] ?? "");
    if (command[0] === "wait" && command[2]?.includes("getLocaleHref")) {
      throw new Error("synthetic readiness timeout");
    }
    return success();
  };

  const exit = await Effect.runPromiseExit(
    switchSignedInLocale(run, "locale-test", "en-US", workspaceE2ETimeouts)
  );

  expect(exit._tag).toBe("Failure");
  expect(commands).toEqual(["wait"]);
});

const success = (stdout = "") => ({ exitCode: 0, stderr: "", stdout });

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://workspace.example",
  bypassSecret: undefined,
  expectedHost: "workspace.example",
  timeouts: workspaceE2ETimeouts,
});
