import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { Skeleton } from "./skeleton";

const appDirectory = resolve(import.meta.dir, "../../..");
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  const sourceStylesPath = join(appDirectory, "app/globals.css");
  const sourceStyles = await readFile(sourceStylesPath, "utf8");
  appStyles = (
    await postcss([tailwindcss()]).process(sourceStyles, {
      from: sourceStylesPath,
    })
  ).css;

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const readShimmer = async (reducedMotion: "no-preference" | "reduce") => {
  if (!browser) throw new Error("The Skeleton browser has not been launched.");
  const page = await browser.newPage({ reducedMotion });
  try {
    await page.setContent(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${renderToStaticMarkup(
        createElement(Skeleton, { className: "h-8 w-64" })
      )}</body></html>`
    );
    await page.addStyleTag({ content: appStyles });
    return await page.locator('[data-slot="skeleton"]').evaluate((element) => {
      const shimmer = getComputedStyle(element, "::after");
      return {
        animationName: shimmer.animationName,
        display: shimmer.display,
      };
    });
  } finally {
    await page.close();
  }
};

test.skipIf(!chromiumAvailable)(
  "animates the skeleton glimmer under normal motion",
  async () => {
    const shimmer = await readShimmer("no-preference");

    expect(shimmer.animationName).toBe("skeleton-glimmer");
    expect(shimmer.display).not.toBe("none");
  }
);

test.skipIf(!chromiumAvailable)(
  "hides the skeleton glimmer when the visitor prefers reduced motion",
  async () => {
    expect((await readShimmer("reduce")).display).toBe("none");
  }
);
