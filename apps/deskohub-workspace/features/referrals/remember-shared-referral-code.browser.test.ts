import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { referralCodeCookieName } from "./referral-code-cookie";

type Evidence = {
  readonly cookie: string;
  readonly initiallyPrerendered: boolean;
};

const chromiumAvailable = await playwrightChromiumAvailable();
let buildDirectory = "";
let bundle = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "referral-prerender-"));
  const build = await Bun.build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    entrypoints: [
      join(
        import.meta.dir,
        "remember-shared-referral-code.browser-harness.tsx"
      ),
    ],
    format: "iife",
    minify: true,
    naming: "harness.js",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  bundle = await Bun.file(join(buildDirectory, "harness.js")).text();
});

afterAll(async () => {
  if (buildDirectory) {
    await rm(buildDirectory, { force: true, recursive: true });
  }
});

test.skipIf(!chromiumAvailable)(
  "remembers a shared code when Chrome activates a page it prerendered",
  async () => {
    const proxyCaptures: boolean[] = [];
    let resolveEvidence!: (evidence: Evidence) => void;
    const evidence = new Promise<Evidence>((resolve) => {
      resolveEvidence = resolve;
    });
    const target = "/en-US/account?ref=RFLFIRST1";
    // Chrome prerenders only for a page it was not told to automate, so the
    // browser runs natively instead of under Playwright's DevTools control.
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/start") {
          return new Response(
            `<!doctype html><html><body><a id="go" href="${target}">Visit</a><script type="speculationrules">${JSON.stringify({ prerender: [{ eagerness: "immediate", urls: [target] }] })}</script><script>setTimeout(() => document.getElementById("go").click(), 2000)</script></body></html>`,
            { headers: { "content-type": "text/html" } }
          );
        }
        if (url.pathname === "/evidence") {
          resolveEvidence((await request.json()) as Evidence);
          return new Response("ok");
        }
        if (url.pathname === "/harness.js") {
          return new Response(bundle, {
            headers: { "content-type": "text/javascript" },
          });
        }
        if (url.pathname !== "/en-US/account") {
          return new Response("", { status: 404 });
        }
        const response = await proxy(new NextRequest(request));
        proxyCaptures.push(response.cookies.has(referralCodeCookieName));
        const headers = new Headers(response.headers);
        headers.set("content-type", "text/html");
        return new Response(
          `<!doctype html><html><body><div id="root"></div><script src="/harness.js"></script></body></html>`,
          { headers, status: response.status }
        );
      },
    });
    const profile = await mkdtemp(join(tmpdir(), "referral-prerender-chrome-"));
    const browser = Bun.spawn(
      [
        chromium.executablePath(),
        "--headless",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        `--user-data-dir=${profile}`,
        new URL("/start", server.url).href,
      ],
      { stderr: "ignore", stdout: "ignore" }
    );
    try {
      const shown = await Promise.race([
        evidence,
        Bun.sleep(30_000).then(() => {
          throw new Error("The activated page reported nothing.");
        }),
      ]);

      expect(shown.initiallyPrerendered).toBe(true);
      // The proxy only saw the speculative request and rightly skipped it.
      expect(proxyCaptures).toEqual([false]);
      expect(shown.cookie).toContain(`${referralCodeCookieName}=RFLFIRST1`);
    } finally {
      browser.kill();
      await browser.exited;
      server.stop(true);
      await rm(profile, { force: true, recursive: true });
    }
  },
  60_000
);
