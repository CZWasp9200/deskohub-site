import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { buildPosthogIdentityFixtureBundle } from "./posthog-identity-fixture-bundle";

// CI never runs the PostHog identity browser check, so this builds its fixture
// with the shared bundler setup and fails when an import change leaks a module
// that touches `process` (or other server-only globals) into the bundle.
const outdir = mkdtempSync(join(tmpdir(), "posthog-identity-fixture-"));
let build: Awaited<ReturnType<typeof buildPosthogIdentityFixtureBundle>>;
let bundle = "";

beforeAll(async () => {
  build = await buildPosthogIdentityFixtureBundle(
    "https://telemetry.posthog.test",
    outdir
  );
  const output = build.outputs.find((candidate) =>
    candidate.path.endsWith(".js")
  );
  bundle = output ? await Bun.file(output.path).text() : "";
}, 60_000);

afterAll(() => rmSync(outdir, { force: true, recursive: true }));

const isFunctionLike = (node: ts.Node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

/**
 * `process.env` reads a browser would reach: any at module level, and any in a
 * function that has not checked `typeof process` first.
 */
const unguardedProcessEnvReads = (source: string) => {
  const file = ts.createSourceFile(
    "bundle.js",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const reads: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process"
    ) {
      let scope = node.parent;
      while (scope && !isFunctionLike(scope)) scope = scope.parent;
      const guarded =
        scope !== undefined &&
        source
          .slice(scope.getStart(file), node.getStart(file))
          .includes("typeof process");
      if (!guarded) {
        const { line } = file.getLineAndCharacterOfPosition(
          node.getStart(file)
        );
        reads.push(`${line + 1}: ${node.parent.getText(file).slice(0, 80)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return reads;
};

// Web-standard APIs a browser also provides, borrowed from the runtime.
const webStandardGlobals = [
  "AbortController",
  "AbortSignal",
  "BroadcastChannel",
  "Blob",
  "CustomEvent",
  "DOMException",
  "Event",
  "EventTarget",
  "FormData",
  "Headers",
  "MessageChannel",
  "ReadableStream",
  "Request",
  "Response",
  "TextDecoder",
  "TextEncoder",
  "TransformStream",
  "URL",
  "URLSearchParams",
  "WritableStream",
  "atob",
  "btoa",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "performance",
  "queueMicrotask",
  "setInterval",
  "setTimeout",
  "structuredClone",
] as const;

/** Globals a browser offers at module init; deliberately no `process`. */
const browserLikeGlobals = () => {
  const events = new EventTarget();
  const context = {
    ...Object.fromEntries(
      webStandardGlobals.map((name) => [name, globalThis[name]])
    ),
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    fetch: () => Promise.reject(new Error("no network in the bundle guard")),
    navigator: { language: "en-US", userAgent: "bundle-guard" },
    removeEventListener: events.removeEventListener.bind(events),
  };
  return Object.assign(context, {
    globalThis: context,
    self: context,
    window: context,
  });
};

test("builds the fixture bundle with the browser check's bundler setup", () => {
  expect(build.success).toBe(true);
  expect(bundle.length).toBeGreaterThan(0);
});

test("keeps unguarded process.env reads out of the fixture bundle", () => {
  expect(unguardedProcessEnvReads(bundle)).toEqual([]);
});

test("initializes the fixture bundle without process or a DOM", () => {
  // The bundle ends with an ESM export list; the rest is a classic script.
  const script = bundle.replace(/\nexport \{[^}]*\};?\s*$/, "\n");
  expect(() =>
    runInNewContext(script, browserLikeGlobals(), {
      filename: "posthog-identity-browser-fixture.js",
    })
  ).not.toThrow();
});
