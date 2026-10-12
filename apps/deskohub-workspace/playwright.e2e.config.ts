import "./shared/testing/workspace-test-environment";

import { defineConfig } from "@playwright/test";
import {
  workspaceE2EPlaywrightDefaults,
  workspaceE2EPlaywrightReporter,
} from "./e2e/playwright-defaults";
import {
  workspaceE2EAccessCodePlaywrightTimeout,
  workspaceE2EPlaywrightCheckoutTimeout,
} from "./e2e/timeouts";

const checkoutCaseProjects = ["checkout-cases"] as const;

export default defineConfig({
  ...workspaceE2EPlaywrightDefaults,
  outputDir: "./e2e-artifacts/checkout",
  projects: [
    {
      dependencies: ["checkout-setup"],
      name: "access-code-creation",
      testDir: "./e2e/access-codes",
      testMatch: "**/*.pw.ts",
      timeout: workspaceE2EAccessCodePlaywrightTimeout,
    },
    {
      name: "checkout-setup",
      teardown: "checkout-cleanup",
      testMatch: "setup.pw.ts",
    },
    {
      dependencies: ["checkout-setup"],
      name: "checkout-seed",
      testMatch: "seed.pw.ts",
    },
    {
      // Playwright awaits every project of a dependency phase before the next
      // one, so the long serial account lane shares the case phase.
      dependencies: ["checkout-plan"],
      name: "account-auth",
      testDir: "./e2e/account",
      testMatch: "account-lane.pw.ts",
      use: {
        screenshot: "off",
        trace: "off",
        video: "off",
      },
    },
    {
      dependencies: ["checkout-setup", "checkout-seed"],
      name: "checkout-plan",
      testMatch: "plan.pw.ts",
    },
    {
      dependencies: ["checkout-plan"],
      name: "checkout-cases",
      testMatch: "cases.pw.ts",
      // The hosted-payment permit, not the project, bounds Nexi sessions. The
      // case phase may queue account-auth after every case; the cap leaves a
      // worker free for the account lane from the first batch.
      workers: 5,
    },
    {
      dependencies: [...checkoutCaseProjects],
      name: "checkout-shared-fixture",
      testMatch: "shared-fixture.pw.ts",
    },
    {
      // Locks the invoices table and disables its immutability trigger, so it
      // must never overlap a paid case.
      dependencies: [...checkoutCaseProjects],
      name: "checkout-invoice-persistence",
      testMatch: "invoice-persistence.pw.ts",
    },
    {
      name: "checkout-cleanup",
      testMatch: "cleanup.pw.ts",
    },
  ],
  reporter: workspaceE2EPlaywrightReporter("Workspace E2E"),
  testDir: "./e2e/playwright-checkout",
  timeout: workspaceE2EPlaywrightCheckoutTimeout,
  workers: 6,
});
