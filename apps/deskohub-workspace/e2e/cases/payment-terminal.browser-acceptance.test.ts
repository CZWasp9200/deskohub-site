import "@/shared/polyfills/temporal";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect, Schema } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import type { E2EBrowserSession } from "../browser-session";
import {
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import type { HostedPaymentPage } from "../checkout/nexi-hosted-payment";
import { retryPaymentInPlace } from "../checkout/payment-retry";
import { workspaceE2ETimeouts } from "../timeouts";
import { leaveRejectedHostedPayment } from "./checkout";
import {
  assertReturnedTerminalStatusPage,
  assertTerminalStatusPage,
  getPaymentTerminalScenarios,
} from "./payment-terminal";

const available = await playwrightChromiumAvailable();
const browserTest = test.skipIf(!available);
let browser: Browser | undefined;
const documents = new Map<string, string>();
const requests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url);
    requests.push(url.pathname);
    return new Response(documents.get(url.pathname) ?? "<main></main>", {
      headers: { "content-type": "text/html" },
    });
  },
});
beforeAll(async () => {
  if (available) browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  server.stop(true);
});
const requireBrowser = () => {
  if (!browser) throw new Error("Chromium is not running");
  return browser;
};
const orderId = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
  "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71"
);
const statusPath = `/en-US/reservation/status/${orderId}`;
const timeouts = {
  ...workspaceE2ETimeouts,
  browserAction: 1_500,
  browserNavigation: 5_000,
  uiTransition: 1_500,
};
const config = {
  baseUrl: server.url.origin,
  bypassSecret: undefined,
  timeouts,
};
const open = (path: string) => (session: E2EBrowserSession) =>
  session.use("open synthetic checkout page", async (page) => {
    await page.goto(new URL(path, server.url).href);
  });
type Result = Awaited<ReturnType<typeof runBrowserStep>>;
const passed = (result: Result) => {
  expect(result.succeeded).toBe(true);
  expect(result.annotations).toEqual([]);
  expect(result.failures).toEqual([]);
};
const failed = (result: Result, kind: "error" | "timeout") => {
  expect(result.succeeded).toBe(false);
  expect(result.annotations).toEqual(failedStepAnnotation(kind));
  expect(result.failures.map(({ timeout }) => timeout)).toEqual([
    kind === "timeout",
  ]);
};

for (const scenario of getPaymentTerminalScenarios()) {
  const body = `<main>${scenario.state === "failed" ? "Payment was not completed." : "Payment was cancelled."} <button id="checkout-status-try-payment-again">Try payment again</button></main>`;
  browserTest(
    `opens and validates the ${scenario.state} status page`,
    async () => {
      documents.set(statusPath, body);
      const result = await runBrowserStep({
        browser: requireBrowser(),
        prepare: () => Effect.void,
        drive: ({ session }) =>
          assertTerminalStatusPage({ config, orderId, scenario, session }),
      });
      passed(result);
    }
  );
  browserTest(
    `validates the returned ${scenario.state} page without reloading`,
    async () => {
      documents.set(statusPath, body);
      const before = requests.length;
      const result = await runBrowserStep({
        browser: requireBrowser(),
        prepare: open(statusPath),
        drive: ({ session }) =>
          assertReturnedTerminalStatusPage({
            orderId,
            scenario,
            session,
            timeouts,
          }),
      });
      passed(result);
      expect(requests.slice(before)).toEqual([statusPath]);
    }
  );
}

browserTest("rejects a return to another order", async () => {
  const result = await runBrowserStep({
    browser: requireBrowser(),
    prepare: open("/en-US/reservation/status/another-order"),
    drive: ({ session }) =>
      assertReturnedTerminalStatusPage({
        orderId,
        scenario: getPaymentTerminalScenarios()[0]!,
        session,
        timeouts,
      }),
  });
  failed(result, "error");
});

browserTest("fails terminal copy that never offers a retry", async () => {
  documents.set(statusPath, "<main>Payment was not completed.</main>");
  const result = await runBrowserStep({
    browser: requireBrowser(),
    prepare: open(statusPath),
    drive: ({ session }) =>
      assertReturnedTerminalStatusPage({
        orderId,
        scenario: getPaymentTerminalScenarios()[0]!,
        session,
        timeouts,
      }),
  });
  failed(result, "timeout");
});

for (const problem of ["none", "another-order", "no-terms"] as const) {
  browserTest(
    `retries the payment on the same order's Pay page: ${problem}`,
    async () => {
      const payOrderId =
        problem === "another-order" ? "another-order" : orderId;
      const payPath = "/en-US/checkout/pay";
      documents.set(
        statusPath,
        `<button id="checkout-status-try-payment-again">Try payment again</button>
      <script>
        const button = document.querySelector('button');
        button.__reactProps$test = { onClick() {} };
        button.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') location.href = '${payPath}?payState=t&orderId=${payOrderId}';
        });
      </script>`
      );
      documents.set(
        payPath,
        problem === "no-terms"
          ? "<main></main>"
          : '<main><input id="checkout-pay-legal-consent" type="checkbox"></main>'
      );
      const result = await runBrowserStep({
        browser: requireBrowser(),
        prepare: open(statusPath),
        drive: ({ session }) =>
          retryPaymentInPlace({
            label: "failed payment",
            orderId,
            session,
            timeouts,
          }),
      });
      if (problem === "none") passed(result);
      else failed(result, problem === "another-order" ? "error" : "timeout");
    }
  );
}

for (const mode of [
  "popup",
  "same-tab",
  "closed-popup",
  "stuck-close",
  "cancelled-delay",
] as const) {
  browserTest(
    `leaves a rejected hosted payment with ${mode}`,
    async () => {
      const payPath = `/checkout/pay/${mode}`;
      documents.set(payPath, "<main>Checkout pay page</main>");
      let hosted: HostedPaymentPage | undefined;
      let activeAfter: Page | undefined;
      const before = requests.length;
      const result = await runBrowserStep({
        browser: requireBrowser(),
        prepare: (session) =>
          session.use("open rejected payment", async (checkoutPage) => {
            await checkoutPage.goto(new URL(statusPath, server.url).href);
            let page = checkoutPage;
            if (mode !== "same-tab") {
              const popup = checkoutPage.waitForEvent("popup", {
                timeout: 5_000,
              });
              await checkoutPage.evaluate(() =>
                window.open("/hpp/nexi/rejected", "_blank")
              );
              page = await popup;
              await page.waitForLoadState("load", { timeout: 5_000 });
            } else
              await page.goto(new URL("/hpp/nexi/rejected", server.url).href);
            hosted = {
              checkoutPage,
              checkoutPageUrl: new URL(payPath, server.url).href,
              page,
              url: page.url(),
            };
            if (mode === "closed-popup") await page.close();
            if (mode === "stuck-close")
              page.close = () => new Promise<void>(() => {});
          }),
        drive: ({ session }) => {
          if (!hosted) throw new Error("missing hosted page");
          return leaveRejectedHostedPayment({
            config,
            hostedPaymentPage: hosted,
            session,
          });
        },
        stepTimeoutMs: mode === "cancelled-delay" ? 1_000 : 15_000,
        afterStep: ({ session }) =>
          session.use("read active page after restart", async (page) => {
            // Observe beyond the real restart delay to catch an abandoned action.
            if (mode === "cancelled-delay") await page.waitForTimeout(5_200);
            activeAfter = page;
          }),
      });
      if (mode === "cancelled-delay") {
        expect(result.succeeded).toBe(false);
        expect(result.annotations).toEqual(failedStepAnnotation("timeout"));
        expect(result.failures).toEqual([]);
        expect(hosted?.page.isClosed()).toBe(true);
        expect(requests.slice(before)).not.toContain(payPath);
      } else if (mode === "closed-popup" || mode === "stuck-close") {
        failed(result, mode === "stuck-close" ? "timeout" : "error");
        expect(requests.slice(before)).not.toContain(payPath);
      } else {
        passed(result);
        expect(activeAfter).toBe(hosted?.checkoutPage);
        expect(
          requests.slice(before).filter((path) => path === payPath)
        ).toHaveLength(1);
        if (mode === "popup") expect(hosted?.page.isClosed()).toBe(true);
      }
    },
    25_000
  );
}
