import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { chromium, type Page } from "@playwright/test";
import { createElement, Suspense, use } from "react";
import { renderToReadableStream } from "react-dom/server";
import { playwrightChromiumAvailable } from "../shared/testing/playwright-browser";
import { waitForReactClickHandler } from "./react-handlers";

const chromiumAvailable = await playwrightChromiumAvailable();
const controlLabel = "Profile & Identity";

function StreamedControl({ ready }: { readonly ready: Promise<void> }) {
  use(ready);
  return createElement(
    "button",
    { "data-control": "content", type: "button" },
    controlLabel
  );
}

/**
 * Streams a document whose Suspense fallback renders the same control as its
 * content, like the account layout's loading shell, and holds the content
 * until the test releases it.
 */
const startStreamedControlServer = async () => {
  let releaseContent = () => {};
  const content = new Promise<void>((resolve) => {
    releaseContent = resolve;
  });
  const server = createServer(async (_request, response) => {
    const stream = await renderToReadableStream(
      createElement(
        "html",
        null,
        createElement(
          "body",
          null,
          createElement(
            Suspense,
            {
              fallback: createElement(
                "button",
                { "data-control": "fallback", disabled: true, type: "button" },
                controlLabel
              ),
            },
            createElement(StreamedControl, { ready: content })
          )
        )
      )
    );
    response.writeHead(200, { "content-type": "text/html" });
    for await (const chunk of stream) response.write(chunk);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("streamed control server did not receive a port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        releaseContent();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    releaseContent: () => releaseContent(),
  };
};

test.skipIf(!chromiumAvailable)(
  "waits on the control a streamed Suspense reveal puts in place of the fallback",
  async () => {
    const server = await startStreamedControlServer();
    try {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(server.baseUrl, { waitUntil: "commit" });
        const control = page.getByRole("button", { name: controlLabel });
        await page
          .locator("[data-control='fallback']")
          .waitFor({ state: "visible" });

        let fallbackObserved = () => {};
        const fallbackObservation = new Promise<void>((resolve) => {
          fallbackObserved = resolve;
        });
        const observedPage: Pick<Page, "waitForFunction"> = {
          waitForFunction: (...args: Parameters<Page["waitForFunction"]>) => {
            fallbackObserved();
            return page.waitForFunction(...args);
          },
        } as Pick<Page, "waitForFunction">;

        const handlerReady = waitForReactClickHandler(observedPage, control);
        // The wait observes the server-rendered fallback first; React's
        // streamed reveal then removes that node and moves the content in.
        await fallbackObservation;
        server.releaseContent();
        const content = page.locator("[data-control='content']");
        await content.waitFor({ state: "visible" });
        expect(await page.locator("[data-control='fallback']").count()).toBe(0);
        await content.evaluate((element) => {
          Object.assign(element, {
            __reactProps$streamed: { onClick: () => undefined },
          });
        });

        await handlerReady;
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  }
);
