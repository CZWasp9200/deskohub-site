import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import type { AccountSection } from "./account-shell";

const locale = "en-US" as const;
const navigationLabel = m.accountNavigationLabel({}, { locale });
const sectionLabels = {
  reservations: m.accountSectionReservations({}, { locale }),
  referrals: m.accountSectionReferrals({}, { locale }),
  profile: m.accountSectionProfile({}, { locale }),
  billing: m.accountSectionBilling({}, { locale }),
  legal: m.accountSectionLegal({}, { locale }),
  danger: m.accountSectionDanger({}, { locale }),
} as const satisfies Readonly<Record<AccountSection, string>>;
const sections = Object.keys(sectionLabels) as AccountSection[];

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let buildDirectory = "";
let browserBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "account-shell-browser-"));
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "account-shell.browser-harness.tsx")],
    format: "iife",
    minify: true,
    naming: "account-shell-harness.js",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  browserBundlePath = join(buildDirectory, "account-shell-harness.js");

  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
});

const openAccountShell = async (viewport: {
  readonly height: number;
  readonly width: number;
}) => {
  if (!browser) throw new Error("The AccountShell browser has not launched.");
  const page = await browser.newPage({ reducedMotion: "reduce", viewport });
  await page.setContent(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="account-shell-test-root"></div></body></html>'
  );
  await page.addStyleTag({ content: appStyles });
  await page.addScriptTag({ path: browserBundlePath });
  await page.getByRole("navigation", { name: navigationLabel }).waitFor();
  return page;
};

const readShellLayout = (page: Page) =>
  page.evaluate((label) => {
    const isRendered = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const navigation = document.querySelector(
      `nav[aria-label=${JSON.stringify(label)}]`
    );
    const content = document.querySelector("aside")?.nextElementSibling;
    if (!navigation || !content) throw new Error("Shell landmarks missing.");
    const navigationRect = navigation.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    return {
      activeButtonLabels: Array.from(
        navigation.querySelectorAll('button[aria-current="page"]')
      )
        .filter(isRendered)
        .map((button) => button.textContent?.trim() ?? ""),
      contentLeft: contentRect.left,
      contentTop: contentRect.top,
      contentWidth: contentRect.width,
      horizontalOverflow:
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth
        ) - window.innerWidth,
      navigationBottom: navigationRect.bottom,
      navigationRight: navigationRect.right,
      navigationWidth: navigationRect.width,
    };
  }, navigationLabel);

const selectSection = async (page: Page, section: AccountSection) => {
  await page
    .getByRole("navigation", { name: navigationLabel })
    .getByRole("button", { name: sectionLabels[section] })
    .filter({ visible: true })
    .click();
};

test.skipIf(!chromiumAvailable)(
  "keeps the desktop navigation beside the content for every section",
  async () => {
    const page = await openAccountShell({ height: 1000, width: 1440 });
    try {
      for (const section of sections) {
        await selectSection(page, section);
        const layout = await readShellLayout(page);

        expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
        expect(layout.navigationWidth).toBeGreaterThan(0);
        expect(layout.contentWidth).toBeGreaterThan(0);
        expect(layout.navigationRight).toBeLessThanOrEqual(layout.contentLeft);
        expect(layout.activeButtonLabels).toHaveLength(1);
        expect(layout.activeButtonLabels[0]).toStartWith(
          sectionLabels[section]
        );
      }
    } finally {
      await page.close();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "stacks the mobile navigation above the content without horizontal overflow",
  async () => {
    const page = await openAccountShell({ height: 900, width: 375 });
    try {
      for (const section of sections) {
        await selectSection(page, section);
        const layout = await readShellLayout(page);

        expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
        expect(layout.contentWidth).toBeGreaterThan(0);
        expect(layout.navigationBottom).toBeLessThanOrEqual(layout.contentTop);
        expect(layout.activeButtonLabels).toEqual([sectionLabels[section]]);
      }
    } finally {
      await page.close();
    }
  }
);
